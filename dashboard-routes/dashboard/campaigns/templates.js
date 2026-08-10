// Live approved-template list for the campaign builder's template picker —
// never hardcoded, always fetched fresh from the Meta API.
import { requireAuth } from '../../../lib/dashboardAuth.js';
import { listTemplates } from '../../../lib/meta.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  if (!requireAuth(req, res)) return;

  try {
    const templates = await listTemplates();
    return res.status(200).json({ templates });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
