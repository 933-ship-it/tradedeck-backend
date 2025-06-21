// File: /api/verify-payment.js

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { orderID } = req.body;
  if (!orderID) {
    return res.status(400).json({ error: 'Missing orderID in request body.' });
  }

  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  try {
    // Step 1: Get OAuth token
    const tokenRes = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(tokenData.error_description || 'Failed to authenticate with PayPal.');

    const accessToken = tokenData.access_token;

    // Step 2: Verify order details
    const orderRes = await fetch(`https://api-m.paypal.com/v2/checkout/orders/${orderID}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const orderData = await orderRes.json();
    if (!orderRes.ok) throw new Error(orderData.message || 'Failed to fetch order.');

    const status = orderData.status;
    const amount = orderData.purchase_units?.[0]?.amount?.value;
    const currency = orderData.purchase_units?.[0]?.amount?.currency_code;
    const buyer = orderData.payer;

    if (status !== 'COMPLETED') {
      return res.status(400).json({ error: 'Order not completed.' });
    }

    return res.status(200).json({
      success: true,
      orderID,
      amount,
      currency,
      buyer: {
        name: buyer.name?.given_name || '',
        email: buyer.email_address || '',
        payer_id: buyer.payer_id || '',
      },
    });
  } catch (err) {
    console.error('[verify-payment] Error:', err);
    return res.status(500).json({ error: err.message || 'Internal Server Error' });
  }
}
