// /api/cloudinary-sign.js

import crypto from 'crypto';

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = 'tradedeck_product_previews';

  const paramsToSign = `folder=${folder}&timestamp=${timestamp}${process.env.CLOUDINARY_API_SECRET}`;
  const signature = crypto
    .createHash('sha1')
    .update(paramsToSign)
    .digest('hex');

  return res.status(200).json({
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    timestamp,
    folder,
    signature
  });
}

