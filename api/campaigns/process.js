// The campaign queue's tick endpoint. Triggered by: self-chaining (the
// primary driver — each tick fires the next one), the dashboard while a
// campaign is open, the daily cron's stalled-campaign sweep, or optionally
// an external cron pinger for fully hands-off long-running sends. Bounded
// to well under Vercel's 60s function timeout (see CAMPAIGN_TICK_BUDGET_MS).
import { secrets } from '../../lib/env.js';
import { processTick } from '../../lib/campaign-sender.js';
import { logSystem } from '../../lib/log.js';

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const provided = req.headers['x-campaign-secret'] || req.query.secret;
  let expected;
  try {
    expected = secrets.CAMPAIGN_SECRET;
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
  if (!provided || provided !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const result = await processTick({ trigger: req.query.trigger || 'http' });
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    await logSystem({ event: 'campaign_tick_error', error: err.message });
    return res.status(500).json({ ok: false, error: err.message });
  }
}
