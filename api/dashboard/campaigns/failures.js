import { requireAuth } from '../../../lib/dashboardAuth.js';
import { getFailureBreakdown } from '../../../lib/campaigns.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  if (!requireAuth(req, res)) return;

  try {
    const result = await getFailureBreakdown(req.query.id);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
