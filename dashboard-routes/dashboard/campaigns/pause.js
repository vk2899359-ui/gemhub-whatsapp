import { requireAuth } from '../../../lib/dashboardAuth.js';
import { getCampaign, updateCampaign, setRunning, STATUSES } from '../../../lib/campaigns.js';
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
  if (campaign.status !== STATUSES.RUNNING) {
    return res.status(400).json({ error: `Campaign is "${campaign.status}", not running` });
  }

  await updateCampaign(campaignId, { status: STATUSES.PAUSED_MANUAL });
  await setRunning(campaignId, false);
  await logSystem({ event: 'campaign_paused', campaignId });

  return res.status(200).json({ ok: true, status: STATUSES.PAUSED_MANUAL });
}
