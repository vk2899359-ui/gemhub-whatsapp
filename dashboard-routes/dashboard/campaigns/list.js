// Campaign list for the monitor tab. Side effect: auto-launches any
// SCHEDULED campaign whose time has come — this plus the daily cron
// watchdog are how "schedule for later" fires on Hobby (no persistent
// timer available); opening the dashboard checks immediately, the cron is
// the backstop for unattended schedules. See README for the full
// reliability discussion.
import { waitUntil } from '@vercel/functions';
import { requireAuth } from '../../../lib/dashboardAuth.js';
import { listCampaigns, updateCampaign, setRunning, STATUSES } from '../../../lib/campaigns.js';
import { processTick } from '../../../lib/campaign-sender.js';
import { logSystem } from '../../../lib/log.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  if (!requireAuth(req, res)) return;

  try {
    const campaigns = await listCampaigns({ limit: 100 });

    const due = campaigns.filter((c) => c.status === STATUSES.SCHEDULED && c.scheduledAt && c.scheduledAt <= Date.now());
    if (due.length) {
      for (const c of due) {
        await updateCampaign(c.id, { status: STATUSES.RUNNING, startedAt: Date.now() });
        await setRunning(c.id, true);
        c.status = STATUSES.RUNNING;
        await logSystem({ event: 'campaign_scheduled_auto_launch', campaignId: c.id });
      }
      waitUntil(processTick({ trigger: 'scheduled' }).catch((err) => logSystem({ event: 'campaign_tick_error', error: err.message })));
    }

    return res.status(200).json({ campaigns });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
