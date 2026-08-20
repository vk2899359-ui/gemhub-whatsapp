// CRM data layer backing the dashboard. Stores a structured, per-conversation
// message thread (not just the flat debug log in lib/log.js) plus a recency
// index and lightweight conversation metadata, all in Redis.
//
// Design notes:
// - `thread:<phone>` is a capped Redis list (oldest -> newest via RPUSH),
//   holding every message with a stable shape: {dir, kind, body, mediaUrl,
//   caption, buttons, sections, tappedId, location, wamid, at}.
// - `conversations` is a ZSET (member=phone, score=last activity ms) so the
//   dashboard can list conversations most-recent-first without a full scan.
// - `conv:meta:<phone>` is a hash: name, lastPreview, lastDir, unreadCount,
//   stage, stageAt, leadBudget, leadOccasion, hasObjection, hasOrder.
// - Bot on/off and ad-sourced are NOT duplicated here — they're read live
//   from the existing escalation/adsrc keys (lib/state.js) so there is a
//   single source of truth and no risk of drifting out of sync with the
//   sliding 24h auto-release.
import { CONFIG } from './env.js';
import { normalizePhone } from './phone.js';
import { redis } from './redis.js';
import { extractBudgetMention, extractOccasionMention, hasObjectionLanguage } from './leadinfo.js';

const AGENT_PHONE = normalizePhone(CONFIG.SALES_AGENT.phone);

const THREAD_CAP = 300;
const THREAD_TTL = 90 * 24 * 60 * 60; // 90 days
const CONV_SET = 'conversations';

const k = {
  thread: (phone) => `thread:${phone}`,
  meta: (phone) => `conv:meta:${phone}`,
  escalation: (phone) => `escalation:${phone}`,
  adSource: (phone) => `adsrc:${phone}`,
  window: (phone) => `window:${phone}`,
};

export const STAGE_ORDER = ['greeted', 'qualified', 'shown_products', 'booked', 'purchased'];
export const STAGE_LABELS = {
  greeted: 'Greeted',
  qualified: 'Qualified',
  shown_products: 'Shown products',
  booked: 'Booked visit',
  purchased: 'Purchased',
};

function isAgent(phone) {
  return Boolean(AGENT_PHONE) && phone === AGENT_PHONE;
}

function clip(str, n) {
  const s = String(str || '');
  return s.length > n ? s.slice(0, n - 1).trim() + '…' : s;
}

function previewFor(entry) {
  switch (entry.kind) {
    case 'text':
      return clip(entry.body, 120);
    case 'image':
      return `📷 ${clip(entry.caption, 100) || 'Photo'}`;
    case 'video':
      return `🎥 ${clip(entry.caption, 100) || 'Video'}`;
    case 'audio':
      return '🎤 Voice message';
    case 'document':
      return `📄 ${entry.filename || 'Document'}`;
    case 'sticker':
      return '💟 Sticker';
    case 'location':
      return '📍 Location';
    case 'buttons':
    case 'list':
      return clip(entry.body, 100) || 'Sent options';
    case 'button_reply':
    case 'list_reply':
    case 'template_button_reply':
      return `↳ ${clip(entry.body, 100)}`;
    case 'cta_url':
      return clip(entry.body, 100) || 'Sent a link';
    case 'template':
      return `📋 ${entry.templateName || 'Template'}`;
    default:
      return clip(entry.body, 100) || entry.kind || '';
  }
}

// ── Recording ───────────────────────────────────────────────────────

/**
 * Append one message to a conversation thread and update its metadata /
 * recency index. `dir` is 'in' | 'out'. No-op for the sales agent's own
 * number (that's not a customer conversation).
 */
export async function recordMessage(phone, entry) {
  if (!phone || isAgent(phone)) return;
  const now = Date.now();
  const full = { dir: entry.dir, at: now, ...entry };
  delete full.phone;

  const r = redis();
  const threadKey = k.thread(phone);
  const metaKey = k.meta(phone);

  await r.rpush(threadKey, JSON.stringify(full));
  await r.ltrim(threadKey, -THREAD_CAP, -1);
  await r.expire(threadKey, THREAD_TTL);

  // Seed stage on first-ever message (HSETNX only writes if absent).
  await r.hsetnx(metaKey, 'stage', 'greeted');
  await r.hsetnx(metaKey, 'stageAt', String(now));

  const patch = {
    lastPreview: previewFor(full),
    lastDir: entry.dir,
    lastAt: String(now),
  };
  if (entry.dir === 'in') {
    await r.hincrby(metaKey, 'unreadCount', 1);

    const budget = extractBudgetMention(entry.body);
    if (budget) patch.leadBudget = budget;
    const occasion = extractOccasionMention(entry.body);
    if (occasion) patch.leadOccasion = occasion;
    if (hasObjectionLanguage(entry.body)) {
      patch.hasObjection = '1';
      patch.objectionAt = String(now);
    }
    if (budget || occasion) await advanceStage(phone, 'qualified');
  }

  await r.hset(metaKey, patch);
  await r.expire(metaKey, THREAD_TTL);

  // A cold outbound touch (campaign blast to someone who has never messaged
  // in and has no existing conversation entry) must NOT create/bump a CRM
  // inbox entry — found live: a 1,000-recipient campaign blast flooded the
  // recency index with one-way sends, burying real customer conversations
  // past any reasonable scroll depth. A reply (dir 'in') always counts, and
  // an outbound reply within an ALREADY-tracked conversation still bumps it.
  const isRealConversation = entry.dir === 'in' || (await r.zscore(CONV_SET, phone)) !== null;
  if (isRealConversation) {
    await r.zadd(CONV_SET, { score: now, member: phone });
  }
}

/** Record a Shopify order event as a system bubble in the thread. */
export async function recordOrderEvent(phone, { kind, body }) {
  if (!phone || isAgent(phone)) return;
  await recordMessage(phone, { dir: 'system', kind: kind || 'order_event', body });
  await redis().hset(k.meta(phone), { hasOrder: '1' });
  if (kind === 'order_paid') await advanceStage(phone, 'purchased');
}

/** Persist / refresh the customer's WhatsApp display name on the conversation. */
export async function setConversationName(phone, name) {
  if (!phone || !name || isAgent(phone)) return;
  await redis().hset(k.meta(phone), { name });
}

/**
 * Tag the conversation with the campaign that sourced this reply, plus the
 * exact resolved offer text they were sent — so the AI consultant can stay
 * on-topic (the specific piece/price they were offered) instead of falling
 * back to a generic opener when a campaign recipient replies.
 */
export async function setConversationCampaignSource(phone, campaignId, offerText) {
  if (!phone || !campaignId || isAgent(phone)) return;
  const patch = { campaignSource: campaignId };
  if (offerText) patch.campaignOffer = offerText;
  await redis().hset(k.meta(phone), patch);
}

/** The resolved offer text from the campaign that sourced this conversation, if any. */
export async function getConversationCampaignOffer(phone) {
  if (!phone) return null;
  const offer = await redis().hget(k.meta(phone), 'campaignOffer');
  return offer ? String(offer) : null;
}

/** The campaign id that sourced this conversation, if any. */
export async function getConversationCampaignSource(phone) {
  if (!phone) return null;
  const id = await redis().hget(k.meta(phone), 'campaignSource');
  return id ? String(id) : null;
}

/** Advance stage forward only (never regresses); no-op if already past it. */
export async function advanceStage(phone, candidate) {
  if (!phone || isAgent(phone)) return;
  const idx = STAGE_ORDER.indexOf(candidate);
  if (idx < 0) return;
  const metaKey = k.meta(phone);
  const current = await redis().hget(metaKey, 'stage');
  const currentIdx = STAGE_ORDER.indexOf(current);
  if (idx > currentIdx) {
    await redis().hset(metaKey, { stage: candidate, stageAt: String(Date.now()) });
  }
}

export async function markConversationRead(phone) {
  if (!phone) return;
  await redis().hset(k.meta(phone), { unreadCount: '0' });
}

export const CALL_TAGS = new Set(['not_answering', 'not_interested', 'interested']);

/**
 * Sales-team call outcome tag (set manually from the dashboard after a
 * phone call) — separate from the bot's own conversation stage, which
 * tracks WhatsApp chat progress, not call follow-up.
 */
export async function setCallTag(phone, tag) {
  if (!phone) return;
  if (tag === null) {
    await redis().hdel(k.meta(phone), 'callTag');
    return;
  }
  if (!CALL_TAGS.has(tag)) throw new Error(`Invalid call tag: ${tag}`);
  await redis().hset(k.meta(phone), { callTag: tag });
}

export const CALLED_BY_OPTIONS = new Set(['Keshav', 'Sonia', 'Reshma']);

/** Which sales-team member called this lead — set manually from the dashboard. */
export async function setCalledBy(phone, name) {
  if (!phone) return;
  if (name === null) {
    await redis().hdel(k.meta(phone), 'calledBy');
    return;
  }
  if (!CALLED_BY_OPTIONS.has(name)) throw new Error(`Invalid called-by name: ${name}`);
  await redis().hset(k.meta(phone), { calledBy: name });
}

// ── Reading ─────────────────────────────────────────────────────────

function parseThread(raw) {
  return (raw || [])
    .map((x) => {
      if (typeof x === 'object' && x !== null) return x;
      try {
        return JSON.parse(x);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function parseMeta(hash) {
  const h = hash || {};
  return {
    // Upstash deserializes numeric-looking hash values back into JS numbers
    // (e.g. stored '1' comes back as 1, a name/preview that's all digits
    // comes back as a number) — wrap every string-typed field in String()
    // so downstream .trim()/.includes()/etc never hits a non-string.
    name: h.name != null ? String(h.name) : null,
    stage: h.stage ? String(h.stage) : 'greeted',
    stageAt: h.stageAt ? Number(h.stageAt) : null,
    leadBudget: h.leadBudget != null ? String(h.leadBudget) : null,
    leadOccasion: h.leadOccasion != null ? String(h.leadOccasion) : null,
    hasObjection: Number(h.hasObjection) === 1,
    hasOrder: Number(h.hasOrder) === 1,
    unreadCount: Number(h.unreadCount || 0),
    lastPreview: h.lastPreview != null ? String(h.lastPreview) : '',
    lastDir: h.lastDir != null ? String(h.lastDir) : null,
    lastAt: h.lastAt ? Number(h.lastAt) : null,
    campaignSource: h.campaignSource ? String(h.campaignSource) : null,
    campaignOffer: h.campaignOffer ? String(h.campaignOffer) : null,
    callTag: h.callTag != null ? String(h.callTag) : null,
    calledBy: h.calledBy != null ? String(h.calledBy) : null,
  };
}

/** Full thread (oldest -> newest) + metadata + live bot/window status. */
export async function getConversation(phone) {
  const r = redis();
  const [rawThread, meta, escalated, adSourced, windowTtl] = await Promise.all([
    r.lrange(k.thread(phone), 0, -1),
    r.hgetall(k.meta(phone)),
    r.get(k.escalation(phone)),
    r.get(k.adSource(phone)),
    r.ttl(k.window(phone)),
  ]);
  return {
    phone,
    messages: parseThread(rawThread),
    ...parseMeta(meta),
    botOn: !escalated,
    handoverReason: parseEscalationReason(escalated),
    adSourced: Boolean(adSourced),
    windowOpen: windowTtl > 0,
    windowTtlSeconds: windowTtl > 0 ? windowTtl : 0,
  };
}

function parseEscalationReason(raw) {
  if (!raw) return null;
  try {
    const rec = typeof raw === 'object' ? raw : JSON.parse(raw);
    return rec.reason || null;
  } catch {
    return typeof raw === 'string' ? raw : null;
  }
}

// Bulk-campaign replies are meant to live under the dedicated "Campaign"
// filter, not flood the default inbox alongside organic/ad/direct
// conversations — a launch to thousands of recipients would otherwise bury
// everything else in the list the moment replies start coming in.
const DEFAULT_LIST_SCAN_POOL = 2000;

/**
 * Conversation list, most-recent-first, with live bot/window status merged
 * in via a single pipelined round trip. Excludes campaign-sourced
 * conversations (see above) — those only show under the Campaign filter.
 */
export async function listConversations({ limit = 50, offset = 0 } = {}) {
  const r = redis();
  const pool = await r.zrange(CONV_SET, 0, DEFAULT_LIST_SCAN_POOL - 1, { rev: true });
  if (!pool.length) return [];
  const hydrated = await hydrate(pool);
  const filtered = hydrated.filter((c) => !c.campaignSource);
  return filtered.slice(offset, offset + limit);
}

async function hydrate(rawPhones) {
  // Upstash returns ZSET members as JS numbers when they look numeric (all
  // our phone numbers do) — normalize back to strings so every downstream
  // string op/comparison (.includes, ===, template-literal keys) is safe.
  const phones = rawPhones.map(String);
  const r = redis();
  const pipeline = r.pipeline();
  for (const phone of phones) {
    pipeline.hgetall(k.meta(phone));
    pipeline.get(k.escalation(phone));
    pipeline.get(k.adSource(phone));
    pipeline.ttl(k.window(phone));
  }
  const results = await pipeline.exec();

  return phones.map((phone, i) => {
    const meta = results[i * 4 + 0];
    const escalated = results[i * 4 + 1];
    const adSourced = results[i * 4 + 2];
    const windowTtl = results[i * 4 + 3];
    return {
      phone,
      ...parseMeta(meta),
      botOn: !escalated,
      handoverReason: parseEscalationReason(escalated),
      adSourced: Boolean(adSourced),
      windowOpen: windowTtl > 0,
      windowTtlSeconds: windowTtl > 0 ? windowTtl : 0,
    };
  });
}

/**
 * Lead-stage breakdown for conversations sourced from a given campaign.
 * User-initiated (campaign analytics drill-down), not part of polling —
 * bounded to the same recency pool as search.
 */
export async function getStageBreakdownForCampaign(campaignId) {
  const r = redis();
  const phones = await r.zrange(CONV_SET, 0, SEARCH_POOL - 1, { rev: true });
  if (!phones.length) return { total: 0, byStage: {} };

  const items = await hydrate(phones);
  const matched = items.filter((c) => c.campaignSource === campaignId);
  const byStage = {};
  for (const c of matched) byStage[c.stage] = (byStage[c.stage] || 0) + 1;
  return { total: matched.length, byStage };
}

// ── Search + filter ────────────────────────────────────────────────

const SEARCH_POOL = 2000; // bounded scan for search/filter — sized to survive a big campaign's reply volume

/**
 * @param {{q?:string, filter?:'unread'|'handed_over'|'ad_sourced'|'campaign_sourced'|'has_order', limit?:number}} opts
 */
export async function searchConversations({ q, filter, limit = 100 } = {}) {
  const r = redis();
  const phones = await r.zrange(CONV_SET, 0, SEARCH_POOL - 1, { rev: true });
  if (!phones.length) return [];

  let items = await hydrate(phones);

  // Same rule as listConversations: campaign replies stay out of every
  // other view (including search) unless the Campaign filter is explicitly on.
  if (filter !== 'campaign_sourced') items = items.filter((c) => !c.campaignSource);

  const query = (q || '').trim().toLowerCase();
  if (query) {
    let matched = items.filter(
      (c) =>
        c.phone.includes(query) ||
        (c.name && c.name.toLowerCase().includes(query)) ||
        (c.lastPreview && c.lastPreview.toLowerCase().includes(query))
    );
    if (matched.length === 0) {
      // Deeper pass: scan full thread bodies for matches (search is
      // user-initiated and bounded, not part of the polling loop).
      const pipeline = r.pipeline();
      for (const c of items) pipeline.lrange(k.thread(c.phone), 0, -1);
      const threads = await pipeline.exec();
      matched = items.filter((c, i) => {
        const msgs = parseThread(threads[i]);
        return msgs.some((m) => (m.body || '').toLowerCase().includes(query));
      });
    }
    items = matched;
  }

  if (filter === 'unread') items = items.filter((c) => c.unreadCount > 0);
  else if (filter === 'handed_over') items = items.filter((c) => !c.botOn);
  else if (filter === 'ad_sourced') items = items.filter((c) => c.adSourced);
  else if (filter === 'campaign_sourced') items = items.filter((c) => c.campaignSource);
  else if (filter === 'has_order') items = items.filter((c) => c.hasOrder);
  else if (filter === 'call_interested') items = items.filter((c) => c.callTag === 'interested');
  else if (filter === 'call_not_interested') items = items.filter((c) => c.callTag === 'not_interested');
  else if (filter === 'call_not_answering') items = items.filter((c) => c.callTag === 'not_answering');
  else if (filter === 'call_untagged') items = items.filter((c) => !c.callTag);

  return items.slice(0, limit);
}

/**
 * Counts of each call-outcome tag, for the filter chip labels. Scanned from
 * the same bounded pool as search/filter — fine at this business's scale.
 */
export async function getCallTagCounts() {
  const r = redis();
  const phones = await r.zrange(CONV_SET, 0, SEARCH_POOL - 1, { rev: true });
  if (!phones.length) return { interested: 0, not_interested: 0, not_answering: 0, untagged: 0 };

  const items = await hydrate(phones);
  const counts = { interested: 0, not_interested: 0, not_answering: 0, untagged: 0 };
  for (const c of items) {
    if (c.callTag === 'interested') counts.interested++;
    else if (c.callTag === 'not_interested') counts.not_interested++;
    else if (c.callTag === 'not_answering') counts.not_answering++;
    else counts.untagged++;
  }
  return counts;
}
