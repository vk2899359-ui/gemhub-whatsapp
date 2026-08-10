// Direct launch for campaigns AT OR UNDER the test-send threshold — small
// sends don't need the mandatory test-send/approve gate. Larger campaigns
// must go through test-send.js -> approve.js instead (this endpoint refuses
// them, so the gate can't be bypassed by calling the "wrong" endpoint).
import { waitUntil } from '@vercel/functions';
import { requireAuth } from '../../../lib/dashboardAuth.js';
import { getCampaign, updateCampaign, setRunning, STATUSES } from '../../../lib/campaigns.js';
import { processTick } from '../../../lib/campaign-sender.js';
import { CONFIG } from '../../../lib/env.js';
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
  if (campaign.status !== STATUSES.DRAFT) {
    return res.status(400).json({ error: `Campaign is "${campaign.status}", not a draft` });
  }
  if (campaign.totalRecipients > CONFIG.CAMPAIGNS.TEST_SEND_REQUIRED_OVER) {
    return res.status(400).json({
      error: `${campaign.totalRecipients} recipients exceeds the ${CONFIG.CAMPAIGNS.TEST_SEND_REQUIRED_OVER}-recipient threshold — use test-send + approve instead`,
    });
  }

  if (campaign.scheduledAt && campaign.scheduledAt > Date.now()) {
    await updateCampaign(campaignId, { status: STATUSES.SCHEDULED });
    return res.status(200).json({ ok: true, status: STATUSES.SCHEDULED });
  }

  await updateCampaign(campaignId, { status: STATUSES.RUNNING, startedAt: Date.now() });
  await setRunning(campaignId, true);
  await logSystem({ event: 'campaign_launched_direct', campaignId });

  waitUntil(processTick({ trigger: 'launch' }).catch((err) => logSystem({ event: 'campaign_tick_error', error: err.message })));

  return res.status(200).json({ ok: true, status: STATUSES.RUNNING });
}
