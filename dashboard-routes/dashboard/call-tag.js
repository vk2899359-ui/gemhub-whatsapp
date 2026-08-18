import { requireAuth } from '../../lib/dashboardAuth.js';
import { normalizePhone } from '../../lib/phone.js';
import { setCallTag, CALL_TAGS } from '../../lib/conversations.js';
import { logSystem } from '../../lib/log.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  if (!requireAuth(req, res)) return;

  const phone = normalizePhone(req.body?.phone);
  const raw = req.body?.tag;
  const tag = raw === null || raw === '' || raw === undefined ? null : String(raw);
  if (!phone) return res.status(400).json({ error: 'Missing phone' });
  if (tag !== null && !CALL_TAGS.has(tag)) return res.status(400).json({ error: 'Invalid tag' });

  await setCallTag(phone, tag);
  await logSystem({ event: 'dashboard_call_tag_set', phone, tag });

  return res.status(200).json({ ok: true, tag });
}
