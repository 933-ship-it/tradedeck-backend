// /api/secure-gateway.js (Node.js on Vercel)
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { mode, orderID } = req.body;

  if (!mode) {
    return res.status(400).json({ error: 'Mode is required' });
  }

  if (mode === 'paypal-verify') {
    if (!orderID) {
      return res.status(400).json({ error: 'Missing PayPal order ID' });
    }

    try {
      const clientId = process.env.PAYPAL_CLIENT_ID;
      const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        return res.status(500).json({ error: 'PayPal credentials not configured' });
      }

      const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

      // Get PayPal access token
      const tokenRes = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });

      if (!tokenRes.ok) {
        const errorText = await tokenRes.text();
        return res.status(500).json({ error: 'Failed to get access token', details: errorText });
      }

      const tokenData = await tokenRes.json();
      const accessToken = tokenData.access_token;

      // Fetch the PayPal order
      const orderRes = await fetch(`https://api-m.paypal.com/v2/checkout/orders/${orderID}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const orderData = await orderRes.json();

      if (orderRes.ok && orderData.status === 'COMPLETED') {
        return res.status(200).json({ verified: true, orderData });
      } else {
        return res.status(400).json({
          verified: false,
          error: 'Payment not completed',
          status: orderData.status || 'UNKNOWN',
        });
      }
    } catch (err) {
      console.error('PayPal verification error:', err);
      return res.status(500).json({ error: 'Server error verifying PayPal payment' });
    }
  }

  if (mode === 'cloudinary-sign') {
    return res.status(501).json({ error: 'Cloudinary signature not implemented yet' });
  }

  return res.status(400).json({ error: 'Unsupported mode' });
}
