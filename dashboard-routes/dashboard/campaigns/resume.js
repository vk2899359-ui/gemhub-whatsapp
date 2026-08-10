// Resumes a manually-paused or quality-paused campaign. Also doubles as the
// dashboard's manual "kick the chain" action if a run ever looks stalled —
// safe to call any time since the sender is fully idempotent per recipient.
import { waitUntil } from '@vercel/functions';
import { requireAuth } from '../../../lib/dashboardAuth.js';
import { getCampaign, updateCampaign, setRunning, STATUSES } from '../../../lib/campaigns.js';
import { processTick } from '../../../lib/campaign-sender.js';
import { logSystem } from '../../../lib/log.js';

const RESUMABLE = new Set([STATUSES.PAUSED_MANUAL, STATUSES.PAUSED_QUALITY, STATUSES.RUNNING]);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  if (!requireAuth(req, res)) return;

  const campaignId = req.body?.campaignId;
  const campaign = await getCampaign(campaignId);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  if (!RESUMABLE.has(campaign.status)) {
    return res.status(400).json({ error: `Campaign is "${campaign.status}" — cannot resume` });
  }

  await updateCampaign(campaignId, { status: STATUSES.RUNNING });
  await setRunning(campaignId, true);
  await logSystem({ event: 'campaign_resumed', campaignId });

  waitUntil(processTick({ trigger: 'resume' }).catch((err) => logSystem({ event: 'campaign_tick_error', error: err.message })));

  return res.status(200).json({ ok: true, status: STATUSES.RUNNING });
}
