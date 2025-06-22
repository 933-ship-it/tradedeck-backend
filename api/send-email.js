// /api/send-email.js

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { to_email, product_title, buyer_name } = req.body;

  if (!to_email || !product_title || !buyer_name) {
    return res.status(400).json({ error: 'Missing email data' });
  }

  try {
    const emailRes = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        service_id: process.env.EMAILJS_SERVICE_ID,
        template_id: process.env.EMAILJS_TEMPLATE_ID,
        user_id: process.env.EMAILJS_PRIVATE_KEY,
        template_params: {
          to_email,
          product_title,
          buyer_name,
        },
      }),
    });

    if (!emailRes.ok) {
      const error = await emailRes.text();
      return res.status(500).json({ error: 'Failed to send email', details: error });
    }

    return res.status(200).json({ message: 'Email sent successfully' });
  } catch (err) {
    return res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
}
