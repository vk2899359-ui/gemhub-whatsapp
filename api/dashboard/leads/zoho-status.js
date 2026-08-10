import { requireAuth } from '../../../lib/dashboardAuth.js';
import { redis } from '../../../lib/redis.js';
import { isZohoConfigured } from '../../../lib/env.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  if (!requireAuth(req, res)) return;

  if (!isZohoConfigured()) return res.status(200).json({ configured: false });

  const state = await redis().hgetall('zoho:sync:state');
  return res.status(200).json({
    configured: true,
    listId: state?.listId ? String(state.listId) : null,
    status: state?.status || 'idle',
    imported: Number(state?.imported || 0),
    lastError: state?.lastError || null,
  });
}
