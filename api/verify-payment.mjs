import admin from 'firebase-admin';
import fetch from 'node-fetch';

// Validate essential env variables upfront for faster failure
const {
  FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY,
  PAYPAL_CLIENT_ID,
  PAYPAL_SECRET,
  PAYPAL_ENV,
} = process.env;

if (
  !FIREBASE_PROJECT_ID ||
  !FIREBASE_CLIENT_EMAIL ||
  !FIREBASE_PRIVATE_KEY ||
  !PAYPAL_CLIENT_ID ||
  !PAYPAL_SECRET ||
  !PAYPAL_ENV
) {
  throw new Error('Missing one or more required environment variables.');
}

// Fix private key newlines
const firebasePrivateKey = FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');

// Initialize Firebase Admin SDK once
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey: firebasePrivateKey,
    }),
  });
}

const db = admin.firestore();

const PAYPAL_API_BASE =
  PAYPAL_ENV === 'sandbox'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';

// Simple in-memory rate limiter - for demo only; replace with Redis or similar for prod
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute window
const RATE_LIMIT_MAX_REQUESTS = 20;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed, POST only' });
  }

  // Extract Firebase ID token from Authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing Bearer token' });
  }
  const idToken = authHeader.split('Bearer ')[1];

  let decodedToken;
  try {
    decodedToken = await admin.auth().verifyIdToken(idToken);
  } catch (error) {
    console.error('Firebase ID token verification failed:', error);
    return res.status(401).json({ error: 'Unauthorized: Invalid Firebase ID token' });
  }

  // Rate limit per user ID
  const now = Date.now();
  const userId = decodedToken.uid;
  const userRequests = rateLimitMap.get(userId) || [];
  const recentRequests = userRequests.filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
  if (recentRequests.length >= RATE_LIMIT_MAX_REQUESTS) {
    return res.status(429).json({ error: 'Too many requests. Try again later.' });
  }
  recentRequests.push(now);
  rateLimitMap.set(userId, recentRequests);

  const { orderID, productId } = req.body;
  if (!orderID || !productId) {
    return res.status(400).json({ error: 'Missing orderID or productId in request body' });
  }

  try {
    // Check if orderID already redeemed to prevent replay attacks
    const orderDoc = await db.collection('paypalOrders').doc(orderID).get();
    if (orderDoc.exists) {
      return res.status(400).json({ error: 'Order already redeemed' });
    }

    // Fetch product data from Firestore
    const productDoc = await db.collection('products').doc(productId).get();
    if (!productDoc.exists) {
      return res.status(404).json({ error: 'Product not found' });
    }
    const productData = productDoc.data();

    // Validate product price
    if (!productData.price) {
      return res.status(500).json({ error: 'Product price is not set' });
    }
    const expectedPrice = parseFloat(productData.price).toFixed(2);

    // Get PayPal access token
    const auth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString('base64');
    const tokenRes = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      console.error('Failed to get PayPal access token:', text);
      throw new Error('Failed to get PayPal access token');
    }
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    if (!accessToken) throw new Error('No access token received from PayPal');

    // Verify PayPal order details
    const orderRes = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders/${orderID}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!orderRes.ok) {
      const text = await orderRes.text();
      console.error('Failed to fetch PayPal order details:', text);
      throw new Error('Failed to fetch PayPal order details');
    }
    const orderData = await orderRes.json();

    if (orderData.status !== 'COMPLETED') {
      return res.status(400).json({ error: 'Order not completed', status: orderData.status });
    }

    // Validate paid amount matches product price
    const purchaseUnit = orderData.purchase_units?.[0];
    const paidAmount = purchaseUnit?.amount?.value;
    if (!paidAmount) {
      return res.status(400).json({ error: 'Paid amount missing in PayPal order' });
    }
    if (paidAmount !== expectedPrice) {
      return res.status(400).json({ error: 'Paid amount does not match product price' });
    }

    // Get seller info (assume sellerUserId field)
    const sellerUserId = productData.sellerUserId;
    if (!sellerUserId) {
      return res.status(500).json({ error: 'Seller information missing in product data' });
    }

    // Firestore transaction: save order and update seller balance atomically
    await db.runTransaction(async (transaction) => {
      const orderRef = db.collection('paypalOrders').doc(orderID);
      const sellerRef = db.collection('users').doc(sellerUserId);

      const sellerDoc = await transaction.get(sellerRef);
      if (!sellerDoc.exists) {
        throw new Error('Seller user not found');
      }

      const sellerData = sellerDoc.data();
      const currentBalance = parseFloat(sellerData.balance || 0);
      const commissionRate = 0.3; // 30% platform commission
      const sellerShare = parseFloat(paidAmount) * (1 - commissionRate);

      transaction.set(orderRef, {
        userId,
        productId,
        amount: paidAmount,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      transaction.update(sellerRef, {
        balance: currentBalance + sellerShare,
      });
    });

    return res.status(200).json({ success: true, order: orderData });
  } catch (error) {
    console.error('Payment verification error:', error);
    return res.status(500).json({ error: 'Payment verification failed', details: error.message });
  }
}
