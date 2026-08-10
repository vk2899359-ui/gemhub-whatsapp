// Summary data for the campaign builder's audience picker: total lead
// count, known sources/tags (for filter dropdowns), and import history.
import { requireAuth } from '../../../lib/dashboardAuth.js';
import { getLeadCount, listSources, listTags, listLeadLists } from '../../../lib/leads.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  if (!requireAuth(req, res)) return;

  try {
    const [totalLeads, sources, tags, lists] = await Promise.all([
      getLeadCount(),
      listSources(),
      listTags(),
      listLeadLists(),
    ]);
    return res.status(200).json({ totalLeads, sources, tags, lists });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
