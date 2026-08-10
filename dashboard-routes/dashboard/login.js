import { checkPassword, checkLoginRateLimit, createSessionCookieValue, sessionCookieHeader } from '../../lib/dashboardAuth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const allowed = await checkLoginRateLimit(req);
  if (!allowed) {
    return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  }

  const password = req.body?.password;
  let ok = false;
  try {
    ok = Boolean(password) && checkPassword(password);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  if (!ok) {
    return res.status(401).json({ error: 'Wrong password' });
  }

  res.setHeader('Set-Cookie', sessionCookieHeader(createSessionCookieValue()));
  return res.status(200).json({ ok: true });
}
