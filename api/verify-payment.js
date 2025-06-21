import admin from 'firebase-admin';
import fetch from 'node-fetch';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
}

const db = admin.firestore();

const PAYPAL_API_BASE = process.env.PAYPAL_ENV === 'sandbox'
  ? 'https://api-m.sandbox.paypal.com'
  : 'https://api-m.paypal.com';

// Simple in-memory rate limiter (for demonstration only; use Redis or similar in production)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 20;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const idToken = req.headers.authorization?.split('Bearer ')[1];
  if (!idToken) {
    return res.status(401).json({ error: 'Unauthorized: Missing Firebase ID token' });
  }

  let decodedToken;
  try {
    decodedToken = await admin.auth().verifyIdToken(idToken);
  } catch {
    return res.status(401).json({ error: 'Unauthorized: Invalid Firebase ID token' });
  }

  // Rate limiting per user ID
  const now = Date.now();
  const userId = decodedToken.uid;
  const userRequests = rateLimitMap.get(userId) || [];
  const recentRequests = userRequests.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW_MS);

  if (recentRequests.length >= RATE_LIMIT_MAX_REQUESTS) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }
  recentRequests.push(now);
  rateLimitMap.set(userId, recentRequests);

  const { orderID, productId } = req.body;
  if (!orderID || !productId) {
    return res.status(400).json({ error: 'Missing orderID or productId' });
  }

  try {
    // Check if orderID was already processed (replay protection)
    const orderDoc = await db.collection('paypalOrders').doc(orderID).get();
    if (orderDoc.exists) {
      return res.status(400).json({ error: 'Order already redeemed' });
    }

    // Fetch product data
    const productDoc = await db.collection('products').doc(productId).get();
    if (!productDoc.exists) {
      return res.status(404).json({ error: 'Product not found' });
    }
    const productData = productDoc.data();
    const expectedPrice = parseFloat(productData.price).toFixed(2);

    // Get PayPal access token
    const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`).toString('base64');
    const tokenRes = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!tokenRes.ok) throw new Error('Failed to get PayPal access token');
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // Verify PayPal order
    const orderRes = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders/${orderID}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });
    if (!orderRes.ok) throw new Error('Failed to fetch PayPal order details');
    const orderData = await orderRes.json();

    if (orderData.status !== 'COMPLETED') {
      return res.status(400).json({ error: 'Order not completed', status: orderData.status });
    }

    // Validate paid amount
    const purchaseUnit = orderData.purchase_units?.[0];
    const paidAmount = purchaseUnit?.amount?.value;
    if (paidAmount !== expectedPrice) {
      return res.status(400).json({ error: 'Paid amount does not match product price' });
    }

    // Get seller info (assumes productData has sellerUserId or sellerPaypalEmail)
    const sellerUserId = productData.sellerUserId;
    if (!sellerUserId) {
      return res.status(500).json({ error: 'Seller information missing' });
    }

    // Run Firestore transaction to save order and update seller balance atomically
    await db.runTransaction(async (transaction) => {
      const orderRef = db.collection('paypalOrders').doc(orderID);
      const sellerRef = db.collection('users').doc(sellerUserId);

      const sellerDoc = await transaction.get(sellerRef);
      if (!sellerDoc.exists) {
        throw new Error('Seller user not found');
      }

      const sellerData = sellerDoc.data();
      const currentBalance = parseFloat(sellerData.balance || 0);
      const commissionRate = 0.3; // Platform takes 30%
      const sellerShare = parseFloat(paidAmount) * (1 - commissionRate);

      // Save the order to prevent re-use
      transaction.set(orderRef, {
        userId,
        productId,
        amount: paidAmount,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Update seller balance
      transaction.update(sellerRef, {
        balance: currentBalance + sellerShare,
      });
    });

    // Optional: Log successful verification with details (not shown here)

    return res.status(200).json({ success: true, order: orderData });
  } catch (error) {
    console.error('Payment verification error:', error);
    return res.status(500).json({ error: 'Payment verification failed' });
  }
}
