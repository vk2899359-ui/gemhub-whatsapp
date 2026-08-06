// WhatsApp Cloud API client. Handles free-form text (inside the 24h
// window), template messages (outside it), retries, and logging.
import { CONFIG, secrets } from './env.js';
import { fetchWithRetry } from './http.js';
import { logOutgoing } from './log.js';
import { redis } from './redis.js';
import { productCaption } from './shopify.js';

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

// ── Interactive messages (buttons, lists, media, location, catalog) ──
// WhatsApp limits: "button" type = max 3 reply buttons (title <= 20 chars);
// "list" type = up to 10 rows total (title <= 24, description <= 72).

function clip(str, n) {
  if (!str) return str;
  const s = String(str);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function baseMsg(to, type, payload) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type,
    ...payload,
  };
}

/** Interactive reply buttons (<=3). buttons: [{ id, title }]. */
export async function sendButtons(to, body, buttons, { header, footer } = {}) {
  const interactive = {
    type: 'button',
    body: { text: clip(body, 1024) },
    action: {
      buttons: buttons.slice(0, 3).map((b) => ({
        type: 'reply',
        reply: { id: b.id, title: clip(b.title, 20) },
      })),
    },
  };
  if (header) interactive.header = { type: 'text', text: clip(header, 60) };
  if (footer) interactive.footer = { text: clip(footer, 60) };
  return callGraph(baseMsg(to, 'interactive', { interactive }), { label: 'wa:buttons' });
}

/**
 * Interactive list (use when more than 3 options are needed, up to 10 rows).
 * sections: [{ title, rows: [{ id, title, description }] }]
 */
export async function sendList(to, body, buttonText, sections, { header, footer } = {}) {
  const cleaned = sections.map((s) => ({
    title: clip(s.title, 24),
    rows: s.rows.slice(0, 10).map((r) => ({
      id: r.id,
      title: clip(r.title, 24),
      ...(r.description ? { description: clip(r.description, 72) } : {}),
    })),
  }));
  const interactive = {
    type: 'list',
    body: { text: clip(body, 1024) },
    action: { button: clip(buttonText, 20), sections: cleaned },
  };
  if (header) interactive.header = { type: 'text', text: clip(header, 60) };
  if (footer) interactive.footer = { text: clip(footer, 60) };
  return callGraph(baseMsg(to, 'interactive', { interactive }), { label: 'wa:list' });
}

/** Send an image message with an optional caption. */
export async function sendImage(to, imageUrl, caption) {
  return callGraph(
    baseMsg(to, 'image', { image: { link: imageUrl, ...(caption ? { caption } : {}) } }),
    { label: 'wa:image' }
  );
}

/** Interactive CTA-URL button (a single tappable web link, e.g. View Product). */
export async function sendCtaUrl(to, body, displayText, url, { header, footer } = {}) {
  const interactive = {
    type: 'cta_url',
    body: { text: clip(body, 1024) },
    action: { name: 'cta_url', parameters: { display_text: clip(displayText, 20), url } },
  };
  if (header) interactive.header = { type: 'text', text: clip(header, 60) };
  if (footer) interactive.footer = { text: clip(footer, 60) };
  return callGraph(baseMsg(to, 'interactive', { interactive }), { label: 'wa:cta' });
}

/** Send a location pin. */
export async function sendLocation(to, { latitude, longitude, name, address }) {
  return callGraph(
    baseMsg(to, 'location', { location: { latitude, longitude, name, address } }),
    { label: 'wa:location' }
  );
}

/** Native catalog single-product message (interactive type "product"). */
export async function sendProduct(to, catalogId, retailerId, body) {
  const interactive = {
    type: 'product',
    action: { catalog_id: catalogId, product_retailer_id: retailerId },
  };
  if (body) interactive.body = { text: clip(body, 1024) };
  return callGraph(baseMsg(to, 'interactive', { interactive }), { label: 'wa:product' });
}

/**
 * Native catalog multi-product message (interactive type "product_list").
 * sections: [{ title, product_items: [{ product_retailer_id }] }]
 */
export async function sendProductList(to, catalogId, header, body, sections) {
  const interactive = {
    type: 'product_list',
    header: { type: 'text', text: clip(header, 60) },
    body: { text: clip(body, 1024) },
    action: { catalog_id: catalogId, sections },
  };
  return callGraph(baseMsg(to, 'interactive', { interactive }), { label: 'wa:product_list' });
}

/**
 * Resolve the commerce catalog connected to the WABA. Returns a catalog id or
 * null. Prefers CONFIG.CATALOG_ID; otherwise asks the Graph API once and caches
 * the answer in Redis so we don't look it up on every message.
 */
export async function getCatalogId() {
  if (CONFIG.CATALOG_ID) return CONFIG.CATALOG_ID;
  try {
    const cached = await redis().get('wa:catalog_id');
    if (cached === 'none') return null;
    if (cached) return cached;
  } catch {
    /* redis optional */
  }
  let catalogId = null;
  try {
    const url = graphUrl(`${CONFIG.WABA_ID}/product_catalogs`);
    const res = await fetchWithRetry(
      url,
      { headers: { Authorization: `Bearer ${secrets.META_TOKEN}` } },
      { attempts: 2, baseDelayMs: 500, label: 'wa:catalogs' }
    );
    const json = await res.json().catch(() => ({}));
    catalogId = json?.data?.[0]?.id || null;
  } catch (err) {
    console.warn('[getCatalogId] lookup failed', err?.message);
  }
  try {
    await redis().set('wa:catalog_id', catalogId || 'none', { ex: CONFIG.TTL.CATALOG });
  } catch {
    /* ignore */
  }
  return catalogId;
}

// Shopify-synced WhatsApp catalogs key items by the numeric variant id.
function retailerId(p) {
  const num = String(p.variantId || '').split('/').pop();
  return num || p.handle;
}

/**
 * Show real products like a Meta catalog ad. Uses native catalog product /
 * product_list messages when the WABA has a connected catalogue and
 * WHATSAPP_USE_CATALOG is on; otherwise sends real image messages (up to 4)
 * with catalogue-style captions, then a "View Product" link (single) or a
 * pick-list (multiple).
 */
export async function sendProductCards(to, products, { body } = {}) {
  const items = (products || []).filter(Boolean).slice(0, 4);
  if (items.length === 0) return;
  if (body) await sendText(to, body);

  const catalogId = CONFIG.USE_CATALOG ? await getCatalogId() : null;
  if (catalogId) {
    const withVariant = items.filter((p) => p.variantId);
    if (withVariant.length === 1) {
      await sendProduct(to, catalogId, retailerId(withVariant[0]), productCaption(withVariant[0]));
      return;
    }
    if (withVariant.length > 1) {
      await sendProductList(to, catalogId, 'GemHub — picked for you', 'Tap a piece to see full details:', [
        { title: 'Curated for you', product_items: withVariant.map((p) => ({ product_retailer_id: retailerId(p) })) },
      ]);
      return;
    }
    // No variant ids to map — fall through to the image path.
  }

  for (const p of items) {
    if (p.image) await sendImage(to, p.image, productCaption(p));
    else await sendText(to, productCaption(p));
  }

  if (items.length === 1) {
    const p = items[0];
    if (p.url) await sendCtaUrl(to, 'See full details and book a viewing:', 'View Product', p.url);
  } else {
    await sendList(
      to,
      'Which one would you like to see up close?',
      'Choose a piece',
      [
        {
          title: 'Your shortlist',
          rows: items.map((p) => ({
            id: `product:${p.id}`,
            title: p.title,
            description: [p.price, p.cert].filter(Boolean).join(' · '),
          })),
        },
      ]
    );
  }
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
