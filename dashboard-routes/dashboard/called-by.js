import { requireAuth } from '../../lib/dashboardAuth.js';
import { normalizePhone } from '../../lib/phone.js';
import { setCalledBy, CALLED_BY_OPTIONS } from '../../lib/conversations.js';
import { logSystem } from '../../lib/log.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  if (!requireAuth(req, res)) return;

  const phone = normalizePhone(req.body?.phone);
  const raw = req.body?.name;
  const name = raw === null || raw === '' || raw === undefined ? null : String(raw);
  if (!phone) return res.status(400).json({ error: 'Missing phone' });
  if (name !== null && !CALLED_BY_OPTIONS.has(name)) return res.status(400).json({ error: 'Invalid name' });

  await setCalledBy(phone, name);
  await logSystem({ event: 'dashboard_called_by_set', phone, name });

  return res.status(200).json({ ok: true, name });
}
