// File: /api/send-sale-email.js

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const {
    buyer_name,
    buyer_email,
    seller_paypal_email,
    product_title,
    amount
  } = req.body;

  if (!buyer_name || !buyer_email || !seller_paypal_email || !product_title || !amount) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  try {
    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        service_id: process.env.EMAILJS_SERVICE_ID,
        template_id: process.env.EMAILJS_TEMPLATE_ID,
        user_id: process.env.EMAILJS_USER_ID,
        template_params: {
          buyer_name,
          buyer_email,
          seller_paypal_email,
          product_title,
          amount
        }
      })
    });

    if (!response.ok) {
      const errData = await response.json();
      console.error('[send-sale-email] EmailJS error:', errData);
      throw new Error(errData?.error || 'Failed to send email.');
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('[send-sale-email] Error:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}

