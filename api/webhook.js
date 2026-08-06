// WhatsApp Cloud API webhook.
//   GET  -> Meta verification handshake.
//   POST -> receive inbound messages, ack 200 fast, process async.
import crypto from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { CONFIG, secrets } from '../lib/env.js';
import { readRawBody } from '../lib/http.js';
import { handleInboundMessage } from '../lib/handlers/inbound.js';
import { logSystem } from '../lib/log.js';

// Ask Vercel not to pre-parse the body so we can verify signatures.
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method === 'GET') return verify(req, res);
  if (req.method === 'POST') return receive(req, res);
  res.setHeader('Allow', 'GET, POST');
  return res.status(405).send('Method Not Allowed');
}

// ── GET: verification handshake ──────────────────────────────────────
function verify(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === CONFIG.VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.status(403).send('Forbidden');
}

// ── POST: receive messages ───────────────────────────────────────────
async function receive(req, res) {
  let raw;
  try {
    raw = await readRawBody(req);
  } catch {
    // Always 200 so Meta doesn't retry/disable the webhook.
    return res.status(200).json({ ok: true });
  }

  // Optional signature verification (only if META_APP_SECRET is configured).
  if (secrets.META_APP_SECRET) {
    const sig = req.headers['x-hub-signature-256'];
    if (!validSignature(raw, sig)) {
      await logSystem({ event: 'wa_bad_signature' });
      // Still 200 — a bad signature isn't something Meta should retry.
      return res.status(200).json({ ok: true });
    }
  }

  let body;
  try {
    body = JSON.parse(raw.toString('utf8') || '{}');
  } catch {
    return res.status(200).json({ ok: true });
  }

  // Process asynchronously; return 200 within milliseconds.
  waitUntil(processPayload(body).catch(async (err) => {
    await logSystem({ event: 'wa_process_error', error: err?.message });
  }));

  return res.status(200).json({ ok: true });
}

async function processPayload(body) {
  if (body.object !== 'whatsapp_business_account') return;

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};

      // Delivery/read status callbacks — log and skip.
      if (value.statuses?.length) {
        for (const s of value.statuses) {
          await logSystem({
            event: 'wa_status',
            status: s.status,
            messageId: s.id,
            recipient: s.recipient_id,
          });
        }
      }

      const contacts = value.contacts || [];
      for (const message of value.messages || []) {
        try {
          await handleInboundMessage(message, contacts[0]);
        } catch (err) {
          await logSystem({
            event: 'inbound_handler_error',
            messageId: message?.id,
            error: err?.message,
          });
        }
      }
    }
  }
}

function validSignature(rawBuffer, signatureHeader) {
  if (!signatureHeader) return false;
  const expected =
    'sha256=' +
    crypto
      .createHmac('sha256', secrets.META_APP_SECRET)
      .update(rawBuffer)
      .digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
