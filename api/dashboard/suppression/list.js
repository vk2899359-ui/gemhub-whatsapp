import { requireAuth } from '../../../lib/dashboardAuth.js';
import { listSuppressed, suppressionCount } from '../../../lib/campaigns.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  if (!requireAuth(req, res)) return;

  const [entries, count] = await Promise.all([listSuppressed(), suppressionCount()]);
  return res.status(200).json({ entries, count });
}
