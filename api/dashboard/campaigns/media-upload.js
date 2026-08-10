// Upload a template header image once; returns a media_id reusable across
// an entire campaign send. Accepts base64 (not multipart) — the dashboard
// reads the file client-side via FileReader, keeping this endpoint on plain
// JSON body parsing like every other dashboard route (no extra dependency).
import { requireAuth } from '../../../lib/dashboardAuth.js';
import { uploadMedia } from '../../../lib/meta.js';

const MAX_BYTES = 5 * 1024 * 1024; // Meta's own image-header limit is 5MB

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  if (!requireAuth(req, res)) return;

  const { filename, mimeType, dataBase64 } = req.body || {};
  if (!dataBase64 || !mimeType) {
    return res.status(400).json({ error: 'Missing dataBase64 or mimeType' });
  }
  if (!/^image\//.test(mimeType)) {
    return res.status(400).json({ error: 'Only image uploads are supported for template headers' });
  }

  let buffer;
  try {
    buffer = Buffer.from(dataBase64, 'base64');
  } catch {
    return res.status(400).json({ error: 'Invalid base64 payload' });
  }
  if (buffer.length > MAX_BYTES) {
    return res.status(400).json({ error: 'Image too large — max 5MB' });
  }

  try {
    const mediaId = await uploadMedia(buffer, mimeType, filename || 'header.jpg');
    return res.status(200).json({ ok: true, mediaId });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
}
