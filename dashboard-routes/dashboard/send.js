import { requireAuth } from '../../lib/dashboardAuth.js';
import { normalizePhone } from '../../lib/phone.js';
import { sendText } from '../../lib/whatsapp.js';
import { setEscalated, addActiveHandover } from '../../lib/state.js';
import { logSystem } from '../../lib/log.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  if (!requireAuth(req, res)) return;

  const phone = normalizePhone(req.body?.phone);
  const body = (req.body?.body || '').toString().trim();
  if (!phone || !body) return res.status(400).json({ error: 'Missing phone or body' });

  try {
    await sendText(phone, body);
  } catch (err) {
    // Most likely cause: the customer's 24h free-form window is closed.
    return res.status(502).json({ error: err.message });
  }

  // A manual reply from the dashboard is a human taking over — auto-pause
  // the bot for this customer, same mechanism as the Part 1 handover flow.
  await setEscalated(phone, { reason: 'dashboard_reply' });
  await addActiveHandover(phone);
  await logSystem({ event: 'dashboard_manual_send', phone });

  return res.status(200).json({ ok: true });
}
