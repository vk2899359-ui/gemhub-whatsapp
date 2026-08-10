// Meta Graph API calls for bulk campaigns that aren't message sends
// (lib/whatsapp.js handles those): live approved-template listing, image
// media upload for reuse across a send, and phone-number quality rating.
import { CONFIG, secrets } from './env.js';
import { fetchWithRetry } from './http.js';

function graphUrl(path) {
  return `https://graph.facebook.com/${CONFIG.GRAPH_API_VERSION}/${path}`;
}

function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${secrets.META_TOKEN}`, ...extra };
}

// ── Templates ────────────────────────────────────────────────────────

function summarizeTemplate(t) {
  const header = t.components?.find((c) => c.type === 'HEADER');
  const body = t.components?.find((c) => c.type === 'BODY');
  const footer = t.components?.find((c) => c.type === 'FOOTER');
  const buttons = t.components?.find((c) => c.type === 'BUTTONS');
  const bodyVarCount = ((body?.text || '').match(/\{\{\d+\}\}/g) || []).length;

  return {
    id: t.id,
    name: t.name,
    language: t.language,
    category: t.category,
    status: t.status,
    headerFormat: header?.format || null, // TEXT | IMAGE | VIDEO | DOCUMENT | null
    headerText: header?.format === 'TEXT' ? header.text : null,
    bodyText: body?.text || '',
    bodyVarCount,
    footerText: footer?.text || null,
    buttons: (buttons?.buttons || []).map((b) => ({ type: b.type, text: b.text })),
  };
}

/** All templates the WABA has, regardless of status (dashboard shows status;
 * only APPROVED ones should actually be selectable for sending). */
export async function listTemplates() {
  const out = [];
  let url = graphUrl(`${CONFIG.WABA_ID}/message_templates?limit=100`);
  let guard = 0;
  while (url && guard < 20) {
    guard++;
    const res = await fetchWithRetry(url, { headers: authHeaders() }, { attempts: 3, baseDelayMs: 600, label: 'meta:templates' });
    const json = await res.json();
    if (!res.ok) throw new Error(`Template list failed (${res.status}): ${JSON.stringify(json?.error || json)}`);
    for (const t of json.data || []) out.push(summarizeTemplate(t));
    url = json.paging?.next || null;
  }
  return out;
}

export async function listApprovedTemplates() {
  return (await listTemplates()).filter((t) => t.status === 'APPROVED');
}

// ── Media upload (image header, uploaded once, reused as media_id) ────

/**
 * @param {Buffer} buffer file bytes
 * @param {string} mimeType e.g. 'image/jpeg'
 * @param {string} filename
 * @returns {Promise<string>} media_id, reusable across many sends
 */
export async function uploadMedia(buffer, mimeType, filename) {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('file', new Blob([buffer], { type: mimeType }), filename || 'upload');

  const res = await fetchWithRetry(
    graphUrl(`${CONFIG.PHONE_NUMBER_ID}/media`),
    { method: 'POST', headers: authHeaders(), body: form },
    { attempts: 3, baseDelayMs: 800, label: 'meta:media_upload' }
  );
  const json = await res.json();
  if (!res.ok || !json.id) {
    throw new Error(`Media upload failed (${res.status}): ${JSON.stringify(json?.error || json)}`);
  }
  return json.id;
}

// ── Quality rating ──────────────────────────────────────────────────

/** @returns {Promise<'GREEN'|'YELLOW'|'RED'|'UNKNOWN'>} */
export async function getQualityRating() {
  const res = await fetchWithRetry(
    graphUrl(`${CONFIG.PHONE_NUMBER_ID}?fields=quality_rating`),
    { headers: authHeaders() },
    { attempts: 3, baseDelayMs: 600, label: 'meta:quality' }
  );
  const json = await res.json();
  if (!res.ok) throw new Error(`Quality rating fetch failed (${res.status}): ${JSON.stringify(json?.error || json)}`);
  return json.quality_rating || 'UNKNOWN';
}
