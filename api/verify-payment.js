// File: /api/verify-payment.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { orderID } = req.body;
  if (!orderID) {
    return res.status(400).json({ error: 'Missing order ID' });
  }

  try {
    // Get PayPal access token
    const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`).toString('base64');
    const tokenRes = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // Verify order
    const orderRes = await fetch(`https://api-m.paypal.com/v2/checkout/orders/${orderID}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    const orderData = await orderRes.json();

    if (orderData.status === 'COMPLETED') {
      return res.status(200).json({ success: true, order: orderData });
    } else {
      return res.status(400).json({ success: false, message: 'Order not completed', status: orderData.status });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Verification failed' });
  }
}
