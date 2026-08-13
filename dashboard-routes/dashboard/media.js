// Proxies an inbound WhatsApp media attachment (photo, etc.) for the
// dashboard to display. WhatsApp only ever gives us a media *id* — the
// actual bytes live behind a short-lived, auth-gated URL that has to be
// re-resolved on every view (it isn't stable enough to store once), so this
// re-fetches from Meta each time rather than caching a stale link.
import { requireAuth } from '../../lib/dashboardAuth.js';
import { CONFIG, secrets } from '../../lib/env.js';
import { fetchWithRetry } from '../../lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  if (!requireAuth(req, res)) return;

  const mediaId = req.query.id;
  if (!mediaId || !/^\d+$/.test(mediaId)) {
    return res.status(400).json({ error: 'Missing or invalid media id' });
  }

  try {
    const metaRes = await fetchWithRetry(
      `https://graph.facebook.com/${CONFIG.GRAPH_API_VERSION}/${mediaId}`,
      { headers: { Authorization: `Bearer ${secrets.META_TOKEN}` } },
      { attempts: 2, baseDelayMs: 400, label: 'dashboard:media_lookup' }
    );
    const metaJson = await metaRes.json();
    if (!metaRes.ok || !metaJson.url) {
      return res.status(404).json({ error: 'Media not found or expired' });
    }

    const fileRes = await fetchWithRetry(
      metaJson.url,
      { headers: { Authorization: `Bearer ${secrets.META_TOKEN}` } },
      { attempts: 2, baseDelayMs: 400, label: 'dashboard:media_download' }
    );
    if (!fileRes.ok) return res.status(502).json({ error: 'Media download failed' });

    const buffer = Buffer.from(await fileRes.arrayBuffer());
    res.setHeader('Content-Type', metaJson.mime_type || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.status(200).send(buffer);
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
}
