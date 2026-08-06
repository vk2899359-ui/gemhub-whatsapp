// One-time (idempotent) endpoint to register all Shopify webhooks pointing
// at this deployment's /api/shopify-webhook. Protected by ?secret=.
//
//   GET /api/register-webhooks?secret=YOUR_REGISTER_SECRET
import { CONFIG, secrets } from '../lib/env.js';
import { registerWebhooks, WEBHOOK_TOPICS } from '../lib/shopify.js';
import { logSystem } from '../lib/log.js';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).send('Method Not Allowed');
  }

  const provided = req.query.secret;
  let expected;
  try {
    expected = secrets.REGISTER_SECRET;
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
  if (!provided || provided !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const base = CONFIG.PUBLIC_BASE_URL;
  if (!base) {
    return res
      .status(400)
      .json({ error: 'PUBLIC_BASE_URL is not set in the environment.' });
  }

  const callbackUrl = `${base}/api/shopify-webhook`;

  try {
    const results = await registerWebhooks(callbackUrl);
    await logSystem({ event: 'webhooks_registered', callbackUrl, results });
    return res.status(200).json({
      ok: true,
      callbackUrl,
      topics: WEBHOOK_TOPICS,
      results,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
