// WhatsApp Cloud API client. Handles free-form text (inside the 24h
// window), template messages (outside it), retries, and logging.
import { CONFIG, secrets } from './env.js';
import { fetchWithRetry } from './http.js';
import { logOutgoing } from './log.js';

function graphUrl(path) {
  return `https://graph.facebook.com/${CONFIG.GRAPH_API_VERSION}/${path}`;
}

async function callGraph(body, { label } = {}) {
  const url = graphUrl(`${CONFIG.PHONE_NUMBER_ID}/messages`);
  const res = await fetchWithRetry(
    url,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secrets.META_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    { attempts: 3, baseDelayMs: 600, label: label || 'wa:send' }
  );

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    await logOutgoing({
      ok: false,
      status: res.status,
      to: body.to,
      kind: body.type,
      error: json?.error || json,
    });
    const msg = json?.error?.message || `WhatsApp send failed (${res.status})`;
    throw new Error(msg);
  }

  const messageId = json?.messages?.[0]?.id || null;
  await logOutgoing({
    ok: true,
    to: body.to,
    kind: body.type,
    messageId,
    template: body.template?.name,
  });
  return { messageId, response: json };
}

/** Send a free-form text message (only valid inside the 24h window). */
export async function sendText(to, body, { previewUrl = true } = {}) {
  return callGraph(
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: previewUrl, body },
    },
    { label: 'wa:text' }
  );
}

/**
 * Send a pre-approved template.
 * @param {string} to
 * @param {{name:string, language?:string, components?:any[]}} template
 */
export async function sendTemplate(to, template) {
  const language = template.language || CONFIG.DEFAULT_TEMPLATE_LANG;
  return callGraph(
    {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: {
        name: template.name,
        language: { code: language },
        ...(template.components?.length
          ? { components: template.components }
          : {}),
      },
    },
    { label: `wa:tmpl:${template.name}` }
  );
}

/** Best-effort read receipt. Never throws. */
export async function markRead(messageId) {
  if (!messageId) return;
  try {
    await fetchWithRetry(
      graphUrl(`${CONFIG.PHONE_NUMBER_ID}/messages`),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secrets.META_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId,
        }),
      },
      { attempts: 2, baseDelayMs: 400, label: 'wa:read' }
    );
  } catch (err) {
    console.warn('[markRead] failed', err?.message);
  }
}
