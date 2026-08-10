import { requireAuth } from '../../../lib/dashboardAuth.js';
import { getCampaign } from '../../../lib/campaigns.js';
import { getStageBreakdownForCampaign } from '../../../lib/conversations.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  if (!requireAuth(req, res)) return;

  const campaign = await getCampaign(req.query.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const stageReached = await getStageBreakdownForCampaign(req.query.id).catch(() => ({ total: 0, byStage: {} }));

  return res.status(200).json({ campaign, stageReached });
}
