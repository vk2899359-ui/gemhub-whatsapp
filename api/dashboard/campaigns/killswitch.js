// Global kill switch — halts batch processing for every campaign instantly.
// A persistent gate, not a one-time action: while it's on, ticks no-op for
// ALL campaigns; turning it off lets every still-running campaign resume on
// its own next tick, with no per-campaign action needed.
import { requireAuth } from '../../../lib/dashboardAuth.js';
import { isKillSwitchOn, setKillSwitch } from '../../../lib/campaigns.js';
import { logSystem } from '../../../lib/log.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    if (!requireAuth(req, res)) return;
    return res.status(200).json({ on: await isKillSwitchOn() });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  if (!requireAuth(req, res)) return;

  const on = Boolean(req.body?.on);
  await setKillSwitch(on);
  await logSystem({ event: 'campaign_killswitch', on });

  return res.status(200).json({ ok: true, on });
}
