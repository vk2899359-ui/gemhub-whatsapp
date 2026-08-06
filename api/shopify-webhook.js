// Shopify webhook receiver. Verifies HMAC on the raw body and routes the
// event to the WhatsApp flows. Rejects invalid HMAC with 401.
import { waitUntil } from '@vercel/functions';
import { readRawBody } from '../lib/http.js';
import { verifyShopifyHmac } from '../lib/shopify.js';
import { handleShopifyEvent } from '../lib/handlers/shopify-events.js';
import { logSystem } from '../lib/log.js';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Method Not Allowed');
  }

  let raw;
  try {
    raw = await readRawBody(req);
  } catch {
    return res.status(400).send('Bad Request');
  }

  const hmac = req.headers['x-shopify-hmac-sha256'];
  if (!verifyShopifyHmac(raw, hmac)) {
    await logSystem({ event: 'shopify_bad_hmac' });
    return res.status(401).send('Unauthorized');
  }

  const topic = req.headers['x-shopify-topic'] || '';
  const shop = req.headers['x-shopify-shop-domain'] || '';

  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8') || '{}');
  } catch {
    // HMAC passed but body isn't JSON — ack so Shopify doesn't retry forever.
    return res.status(200).json({ ok: true });
  }

  // Ack immediately; process asynchronously.
  waitUntil(
    handleShopifyEvent(topic, payload).catch(async (err) => {
      await logSystem({
        event: 'shopify_process_error',
        topic,
        error: err?.message,
      });
    })
  );

  await logSystem({ event: 'shopify_received', topic, shop });
  return res.status(200).json({ ok: true });
}
