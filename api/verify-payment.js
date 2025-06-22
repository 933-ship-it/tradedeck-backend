// /api/verify-payment.js

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { orderID } = req.body;

  if (!orderID) {
    return res.status(400).json({ error: 'Missing order ID' });
  }

  try {
    // Get PayPal access token
    const auth = Buffer.from(
      `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
    ).toString('base64');

    const tokenRes = await fetch(`https://api-m.paypal.com/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    const { access_token } = await tokenRes.json();

    // Verify the order
    const orderRes = await fetch(`https://api-m.paypal.com/v2/checkout/orders/${orderID}`, {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    });

    const orderData = await orderRes.json();

    if (orderData.status !== 'COMPLETED') {
      return res.status(400).json({ error: 'Payment not completed' });
    }

    return res.status(200).json({ message: 'Payment verified', details: orderData });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
}
