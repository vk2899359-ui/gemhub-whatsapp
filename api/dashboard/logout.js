import { sessionCookieHeader } from '../../lib/dashboardAuth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  res.setHeader('Set-Cookie', sessionCookieHeader('', { clear: true }));
  return res.status(200).json({ ok: true });
}
