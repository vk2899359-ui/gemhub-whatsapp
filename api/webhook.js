// WhatsApp Cloud API webhook.
//   GET  -> Meta verification handshake.
//   POST -> receive inbound messages, ack 200 fast, process async.
import crypto from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { CONFIG, secrets } from '../lib/env.js';
import { readRawBody } from '../lib/http.js';
import { handleInboundMessage } from '../lib/handlers/inbound.js';
import { logSystem } from '../lib/log.js';
import { resolveCampaignMessage, getRecipientStatus, setRecipientStatus, incrementCounter } from '../lib/campaigns.js';

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

      // Delivery/read status callbacks — log, and feed campaign analytics
      // when the message id maps back to a campaign send.
      if (value.statuses?.length) {
        for (const s of value.statuses) {
          await logSystem({
            event: 'wa_status',
            status: s.status,
            messageId: s.id,
            recipient: s.recipient_id,
            error: s.errors?.[0] ? `${s.errors[0].code}: ${s.errors[0].title || s.errors[0].message}` : undefined,
          });
          try {
            await applyCampaignStatus(s);
          } catch (err) {
            await logSystem({ event: 'campaign_status_apply_error', messageId: s.id, error: err.message });
          }
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

// Idempotency guard per status transition — Meta can (and does) redeliver
// the same status callback, so only count a transition once per recipient.
async function applyCampaignStatus(s) {
  const mapping = await resolveCampaignMessage(s.id);
  if (!mapping) return; // not a campaign-sourced message
  const { campaignId, phone } = mapping;
  const recipient = await getRecipientStatus(campaignId, phone);
  if (!recipient) return;

  if (s.status === 'delivered' && !recipient.deliveredAt) {
    await setRecipientStatus(campaignId, phone, { deliveredAt: Date.now() });
    await incrementCounter(campaignId, 'delivered');
  } else if (s.status === 'read' && !recipient.readAt) {
    await setRecipientStatus(campaignId, phone, { readAt: Date.now() });
    await incrementCounter(campaignId, 'read');
  } else if (s.status === 'failed' && recipient.status !== 'failed') {
    // Delivery-time failure (e.g. undeliverable) distinct from a send-time
    // API rejection, which is already counted where the send itself throws.
    const reason = s.errors?.[0]?.title || s.errors?.[0]?.message || 'Delivery failed';
    await setRecipientStatus(campaignId, phone, { status: 'failed', lastError: reason });
    await incrementCounter(campaignId, 'failed');
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
