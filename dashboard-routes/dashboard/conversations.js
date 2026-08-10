import { requireAuth } from '../../lib/dashboardAuth.js';
import { listConversations, searchConversations } from '../../lib/conversations.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  if (!requireAuth(req, res)) return;

  const q = (req.query.q || '').toString();
  const filter = (req.query.filter || '').toString() || undefined;
  const limit = Math.min(Number(req.query.limit) || 100, 300);

  try {
    const conversations =
      q || filter ? await searchConversations({ q, filter, limit }) : await listConversations({ limit });
    return res.status(200).json({ conversations });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
