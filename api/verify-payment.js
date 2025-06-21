export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { orderId } = req.body;

  if (!orderId) {
    return res.status(400).json({ error: 'Missing orderId' });
  }

  const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
  const PAYPAL_SECRET = process.env.PAYPAL_SECRET;

  const basicAuth = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`).toString('base64');

  try {
    // Step 1: Get access token
    const tokenRes = await fetch("https://api-m.paypal.com/v1/oauth2/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) throw new Error("Failed to get access token");

    // Step 2: Validate order
    const orderRes = await fetch(`https://api-m.paypal.com/v2/checkout/orders/${orderId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const orderData = await orderRes.json();

    if (orderData.status !== 'COMPLETED') {
      return res.status(400).json({ error: 'Payment not completed', details: orderData });
    }

    // Send back only what's necessary
    return res.status(200).json({
      status: 'VERIFIED',
      payer: orderData.payer,
      purchase_units: orderData.purchase_units,
    });

  } catch (err) {
    console.error('Verification error:', err);
    return res.status(500).json({ error: 'Server error', details: err.message });
  }
}
