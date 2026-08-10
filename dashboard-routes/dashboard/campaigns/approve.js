// Explicit approval after a test send — required before any campaign over
// the size threshold (CAMPAIGN_TEST_SEND_REQUIRED_OVER) can start running.
import { waitUntil } from '@vercel/functions';
import { requireAuth } from '../../../lib/dashboardAuth.js';
import { getCampaign, updateCampaign, setRunning, STATUSES } from '../../../lib/campaigns.js';
import { processTick } from '../../../lib/campaign-sender.js';
import { logSystem } from '../../../lib/log.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  if (!requireAuth(req, res)) return;

  const campaignId = req.body?.campaignId;
  const campaign = await getCampaign(campaignId);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  if (campaign.status !== STATUSES.AWAITING_APPROVAL) {
    return res.status(400).json({ error: `Campaign is "${campaign.status}", not awaiting approval` });
  }

  await updateCampaign(campaignId, { status: STATUSES.RUNNING, startedAt: Date.now() });
  await setRunning(campaignId, true);
  await logSystem({ event: 'campaign_approved_and_launched', campaignId });

  waitUntil(processTick({ trigger: 'approve' }).catch((err) => logSystem({ event: 'campaign_tick_error', error: err.message })));

  return res.status(200).json({ ok: true, status: STATUSES.RUNNING });
}
