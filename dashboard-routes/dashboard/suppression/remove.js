import { requireAuth } from '../../../lib/dashboardAuth.js';
import { removeSuppression } from '../../../lib/campaigns.js';
import { logSystem } from '../../../lib/log.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  if (!requireAuth(req, res)) return;

  const phone = await removeSuppression(req.body?.phone);
  if (!phone) return res.status(400).json({ error: 'Invalid phone number' });

  await logSystem({ event: 'suppression_removed_manual', phone });
  return res.status(200).json({ ok: true, phone });
}
