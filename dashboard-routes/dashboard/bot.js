import { requireAuth } from '../../lib/dashboardAuth.js';
import { normalizePhone } from '../../lib/phone.js';
import { setEscalated, clearEscalation, addActiveHandover } from '../../lib/state.js';
import { logSystem } from '../../lib/log.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  if (!requireAuth(req, res)) return;

  const phone = normalizePhone(req.body?.phone);
  const on = Boolean(req.body?.on);
  if (!phone) return res.status(400).json({ error: 'Missing or invalid phone' });

  if (on) {
    await clearEscalation(phone);
  } else {
    await setEscalated(phone, { reason: 'dashboard_manual' });
    await addActiveHandover(phone);
  }
  await logSystem({ event: 'dashboard_bot_toggle', phone, on });

  return res.status(200).json({ ok: true, botOn: on });
}
