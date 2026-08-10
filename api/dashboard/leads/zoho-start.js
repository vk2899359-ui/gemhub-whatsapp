// Dashboard-facing trigger for the Zoho sync — internally calls the
// campaign-secret-protected sync endpoint server-side so the dashboard only
// ever needs its own session cookie, never the internal secret.
import { requireAuth } from '../../../lib/dashboardAuth.js';
import { isZohoConfigured, CONFIG, secrets } from '../../../lib/env.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  if (!requireAuth(req, res)) return;

  if (!isZohoConfigured()) {
    return res.status(400).json({ error: 'Zoho is not configured yet — set ZOHO_CLIENT_ID/SECRET/REFRESH_TOKEN.' });
  }
  if (!CONFIG.PUBLIC_BASE_URL) {
    return res.status(500).json({ error: 'PUBLIC_BASE_URL is not set' });
  }

  try {
    const r = await fetch(`${CONFIG.PUBLIC_BASE_URL}/api/campaigns/zoho-sync`, {
      method: 'POST',
      headers: { 'x-campaign-secret': secrets.CAMPAIGN_SECRET, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start' }),
    });
    const json = await r.json();
    return res.status(r.status).json(json);
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
}
