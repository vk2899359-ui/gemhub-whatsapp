// Bulk campaign data model: campaign records, the resumable recipient
// queue/status, and every safety guardrail (suppression list, cooldown,
// kill switch, daily cap, quality-rating cache). All state lives in Redis,
// following the same conventions as lib/state.js and lib/conversations.js.
//
// Resumability design: `campaign:<id>:queue` is an ORDERED, IMMUTABLE list of
// phones written once at campaign build time. `campaign:<id>:recipient:<phone>`
// is the single source of truth for "has this recipient been handled" — the
// sender always checks this hash before sending, so even if the cursor is
// ever wrong (crash, retry, manual resume) a recipient can never be
// double-sent: the status check is idempotent, the cursor is purely an
// optimisation to avoid rescanning from zero every tick.
import { redis } from './redis.js';
import { normalizePhone } from './phone.js';
import { CONFIG } from './env.js';

const CAMPAIGNS_ALL = 'campaigns:all'; // ZSET score=createdAt
const CAMPAIGNS_RUNNING = 'campaigns:running'; // SET
const KILL_SWITCH = 'campaigns:killswitch';
const SUPPRESSION_SET = 'suppression:optout';
const SUPPRESSION_META = 'suppression:optout:meta'; // hash phone -> JSON{at,via}
const QUALITY_CACHE = 'campaigns:quality:cache'; // hash {rating, checkedAt}

const k = {
  campaign: (id) => `campaign:${id}`,
  queue: (id) => `campaign:${id}:queue`,
  retryQueue: (id) => `campaign:${id}:retryqueue`,
  recipient: (id, phone) => `campaign:${id}:recipient:${phone}`,
  msgMap: (wamid) => `campaign:msg:${wamid}`,
  cooldown: (phone) => `cooldown:${phone}`,
  sentToday: (dateStr) => `campaigns:sent:${dateStr}`,
  lastCampaignSent: (phone) => `campaign:lastsent:${phone}`,
};

export const STATUSES = {
  DRAFT: 'draft',
  TEST_PENDING: 'test_pending',
  AWAITING_APPROVAL: 'awaiting_approval',
  SCHEDULED: 'scheduled',
  RUNNING: 'running',
  PAUSED_MANUAL: 'paused_manual',
  PAUSED_QUALITY: 'paused_quality',
  STOPPED_QUALITY: 'stopped_quality',
  KILLED: 'killed',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

const RECIPIENT_TTL = 60 * 24 * 60 * 60; // 60 days
const MSG_MAP_TTL = 30 * 24 * 60 * 60; // 30 days
const LAST_CAMPAIGN_SENT_TTL = 3 * 24 * 60 * 60; // 3 days (for reply attribution)
const QUALITY_CACHE_TTL = 5 * 60; // 5 minutes

function id() {
  // 'c' prefix guarantees the id can never be all-digits — Upstash
  // deserializes purely-numeric-looking strings back into JS numbers on
  // read, which breaks strict === comparisons downstream. See the same
  // fix applied to conversations.js during Part 2.
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ── Campaign CRUD ───────────────────────────────────────────────────

/**
 * @param {object} fields name, templateName, templateLanguage,
 *   templateComponents, variableMapping, imageMediaId, audienceFilter,
 *   throttlePerSec, cooldownDays, scheduledAt
 */
export async function createCampaign(fields) {
  const campaignId = id();
  const now = Date.now();
  const record = {
    id: campaignId,
    name: fields.name || `Campaign ${campaignId}`,
    templateName: fields.templateName,
    templateLanguage: fields.templateLanguage || 'en',
    templateComponents: JSON.stringify(fields.templateComponents || []),
    variableMapping: JSON.stringify(fields.variableMapping || {}),
    imageMediaId: fields.imageMediaId || '',
    audienceFilter: JSON.stringify(fields.audienceFilter || {}),
    throttlePerSec: String(fields.throttlePerSec || CONFIG.CAMPAIGNS.DEFAULT_THROTTLE_PER_SEC),
    cooldownDays: String(fields.cooldownDays || CONFIG.CAMPAIGNS.DEFAULT_COOLDOWN_DAYS),
    scheduledAt: fields.scheduledAt ? String(fields.scheduledAt) : '',
    status: STATUSES.DRAFT,
    createdAt: String(now),
    startedAt: '',
    completedAt: '',
    lastTickAt: '',
    totalRecipients: '0',
    cursor: '0',
    sentCount: '0',
    deliveredCount: '0',
    readCount: '0',
    failedCount: '0',
    repliedCount: '0',
    optedOutCount: '0',
    skippedCount: '0',
  };
  await redis().hset(k.campaign(campaignId), record);
  await redis().zadd(CAMPAIGNS_ALL, { score: now, member: campaignId });
  return campaignId;
}

export async function getCampaign(campaignId) {
  const h = await redis().hgetall(k.campaign(campaignId));
  if (!h || !h.id) return null;
  return parseCampaign(h);
}

function parseCampaign(h) {
  return {
    id: String(h.id),
    name: h.name,
    templateName: h.templateName,
    templateLanguage: h.templateLanguage,
    templateComponents: safeParse(h.templateComponents, []),
    variableMapping: safeParse(h.variableMapping, {}),
    imageMediaId: h.imageMediaId || null,
    audienceFilter: safeParse(h.audienceFilter, {}),
    throttlePerSec: Number(h.throttlePerSec || 1),
    cooldownDays: Number(h.cooldownDays || 7),
    scheduledAt: h.scheduledAt ? Number(h.scheduledAt) : null,
    status: h.status,
    createdAt: Number(h.createdAt || 0),
    startedAt: h.startedAt ? Number(h.startedAt) : null,
    completedAt: h.completedAt ? Number(h.completedAt) : null,
    lastTickAt: h.lastTickAt ? Number(h.lastTickAt) : null,
    totalRecipients: Number(h.totalRecipients || 0),
    cursor: Number(h.cursor || 0),
    counters: {
      sent: Number(h.sentCount || 0),
      delivered: Number(h.deliveredCount || 0),
      read: Number(h.readCount || 0),
      failed: Number(h.failedCount || 0),
      replied: Number(h.repliedCount || 0),
      optedOut: Number(h.optedOutCount || 0),
      skipped: Number(h.skippedCount || 0),
    },
  };
}

function safeParse(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

export async function updateCampaign(campaignId, patch) {
  const flat = {};
  for (const [key, val] of Object.entries(patch)) {
    flat[key] = typeof val === 'object' ? JSON.stringify(val) : String(val);
  }
  await redis().hset(k.campaign(campaignId), flat);
}

export async function listCampaigns({ limit = 50 } = {}) {
  const ids = (await redis().zrange(CAMPAIGNS_ALL, 0, limit - 1, { rev: true })).map(String);
  if (!ids.length) return [];
  const pipeline = redis().pipeline();
  for (const cid of ids) pipeline.hgetall(k.campaign(cid));
  const results = await pipeline.exec();
  return ids.map((cid, i) => (results[i]?.id ? parseCampaign(results[i]) : null)).filter(Boolean);
}

export async function setRunning(campaignId, running) {
  if (running) await redis().sadd(CAMPAIGNS_RUNNING, campaignId);
  else await redis().srem(CAMPAIGNS_RUNNING, campaignId);
}

export async function listRunningCampaignIds() {
  return (await redis().smembers(CAMPAIGNS_RUNNING)).map(String);
}

export async function incrementCounter(campaignId, field, by = 1) {
  await redis().hincrby(k.campaign(campaignId), `${field}Count`, by);
}

// ── Recipient queue ─────────────────────────────────────────────────

/**
 * Snapshot the resolved audience into an immutable, ordered queue plus a
 * per-recipient status hash. Chunked to keep any single Redis call bounded.
 */
export async function buildRecipientQueue(campaignId, leads) {
  const r = redis();
  const CHUNK = 500;
  const phones = [];
  for (let i = 0; i < leads.length; i += CHUNK) {
    const batch = leads.slice(i, i + CHUNK);
    const pipeline = r.pipeline();
    for (const lead of batch) {
      pipeline.rpush(k.queue(campaignId), lead.phone);
      pipeline.hset(k.recipient(campaignId, lead.phone), {
        phone: lead.phone,
        name: lead.name || '',
        extra: JSON.stringify(lead.extra || {}),
        status: 'pending',
        attempts: '0',
        nextAttemptAt: '0',
        lastError: '',
      });
      pipeline.expire(k.recipient(campaignId, lead.phone), RECIPIENT_TTL);
      phones.push(lead.phone);
    }
    await pipeline.exec();
  }
  await updateCampaign(campaignId, { totalRecipients: phones.length });
  return phones.length;
}

export async function getQueueSlice(campaignId, start, end) {
  return (await redis().lrange(k.queue(campaignId), start, end)).map(String);
}

export async function getQueueLength(campaignId) {
  return redis().llen(k.queue(campaignId));
}

/**
 * Scan all recipients for status==='failed', grouped by error reason.
 * User-initiated only (campaign detail drill-down) — never part of a
 * polling loop, so a bounded pipelined scan over the full queue is fine
 * even for large campaigns.
 */
export async function getFailureBreakdown(campaignId) {
  const r = redis();
  const total = await getQueueLength(campaignId);
  const CHUNK = 500;
  const breakdown = new Map();
  const sample = [];

  for (let i = 0; i < total; i += CHUNK) {
    const phones = await getQueueSlice(campaignId, i, Math.min(i + CHUNK, total) - 1);
    const pipeline = r.pipeline();
    for (const phone of phones) pipeline.hgetall(k.recipient(campaignId, phone));
    const results = await pipeline.exec();
    results.forEach((h, idx) => {
      if (h?.status !== 'failed') return;
      const reason = h.lastError || 'Unknown error';
      breakdown.set(reason, (breakdown.get(reason) || 0) + 1);
      if (sample.length < 50) sample.push({ phone: phones[idx], reason });
    });
  }

  return {
    total: [...breakdown.values()].reduce((a, b) => a + b, 0),
    breakdown: [...breakdown.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    sample,
  };
}

export async function getRecipientStatus(campaignId, phone) {
  const h = await redis().hgetall(k.recipient(campaignId, phone));
  if (!h || !h.phone) return null;
  return {
    // Upstash deserializes numeric-looking hash values back into JS numbers
    // (same gotcha as lib/conversations.js) — always coerce phones to string.
    phone: String(h.phone),
    name: h.name || '',
    extra: safeParse(h.extra, {}),
    status: h.status,
    attempts: Number(h.attempts || 0),
    nextAttemptAt: Number(h.nextAttemptAt || 0),
    lastError: h.lastError || '',
    sentAt: h.sentAt ? Number(h.sentAt) : null,
    deliveredAt: h.deliveredAt ? Number(h.deliveredAt) : null,
    readAt: h.readAt ? Number(h.readAt) : null,
    repliedAt: h.repliedAt ? Number(h.repliedAt) : null,
  };
}

export async function setRecipientStatus(campaignId, phone, patch) {
  const flat = {};
  for (const [key, val] of Object.entries(patch)) flat[key] = String(val);
  await redis().hset(k.recipient(campaignId, phone), flat);
}

export async function setCursor(campaignId, cursor) {
  await updateCampaign(campaignId, { cursor });
}

// ── Retry queue — recipients awaiting a backoff-delayed re-attempt. Kept
// separate from the primary queue so a handful of slow retries can never
// stall the primary cursor's forward progress. ─────────────────────────

export async function pushRetry(campaignId, phone) {
  await redis().rpush(k.retryQueue(campaignId), phone);
}

export async function popRetry(campaignId) {
  const v = await redis().lpop(k.retryQueue(campaignId));
  return v ? String(v) : null;
}

export async function pushRetryBack(campaignId, phone) {
  // Not ready yet — re-queue at the tail so other ready retries get a turn.
  await redis().rpush(k.retryQueue(campaignId), phone);
}

export async function getRetryQueueLength(campaignId) {
  return redis().llen(k.retryQueue(campaignId));
}

// ── Message-id -> campaign/phone mapping (for status webhooks) ────────

export async function mapCampaignMessage(wamid, campaignId, phone) {
  if (!wamid) return;
  await redis().set(k.msgMap(wamid), JSON.stringify({ campaignId, phone }), { ex: MSG_MAP_TTL });
}

export async function resolveCampaignMessage(wamid) {
  const raw = await redis().get(k.msgMap(wamid));
  if (!raw) return null;
  return typeof raw === 'object' ? raw : safeParse(raw, null);
}

// ── Reply attribution ───────────────────────────────────────────────

export async function markLastCampaignSent(phone, campaignId) {
  await redis().set(k.lastCampaignSent(phone), campaignId, { ex: LAST_CAMPAIGN_SENT_TTL });
}

export async function getLastCampaignSent(phone) {
  const v = await redis().get(k.lastCampaignSent(phone));
  return v ? String(v) : null;
}

// ── Suppression (opt-out) list — permanent, honoured by every campaign ─

export async function isSuppressed(phone) {
  return Boolean(await redis().sismember(SUPPRESSION_SET, phone));
}

export async function addSuppression(phone, { via = 'manual' } = {}) {
  const p = normalizePhone(phone);
  if (!p) return null;
  await redis().sadd(SUPPRESSION_SET, p);
  await redis().hset(SUPPRESSION_META, { [p]: JSON.stringify({ at: Date.now(), via }) });
  return p;
}

export async function removeSuppression(phone) {
  const p = normalizePhone(phone);
  if (!p) return null;
  await redis().srem(SUPPRESSION_SET, p);
  await redis().hdel(SUPPRESSION_META, p);
  return p;
}

export async function listSuppressed() {
  const r = redis();
  const phones = (await r.smembers(SUPPRESSION_SET)).map(String);
  if (!phones.length) return [];
  const meta = await r.hgetall(SUPPRESSION_META);
  return phones
    .map((phone) => {
      const raw = meta?.[phone];
      const parsed = raw ? (typeof raw === 'object' ? raw : safeParse(raw, {})) : {};
      return { phone, at: parsed.at || null, via: parsed.via || 'unknown' };
    })
    .sort((a, b) => (b.at || 0) - (a.at || 0));
}

export async function suppressionCount() {
  return redis().scard(SUPPRESSION_SET);
}

// ── Cooldown — nobody gets 2 marketing campaigns within X days ────────

export async function isInCooldown(phone) {
  return Boolean(await redis().get(k.cooldown(phone)));
}

export async function markCooldown(phone, days) {
  await redis().set(k.cooldown(phone), '1', { ex: Math.max(1, days) * 24 * 60 * 60 });
}

// ── Kill switch ─────────────────────────────────────────────────────

export async function isKillSwitchOn() {
  return Boolean(await redis().get(KILL_SWITCH));
}

export async function setKillSwitch(on) {
  if (on) await redis().set(KILL_SWITCH, '1');
  else await redis().del(KILL_SWITCH);
}

// ── Global daily cap ────────────────────────────────────────────────

function todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

export async function getSentToday() {
  const v = await redis().get(k.sentToday(todayKey()));
  return Number(v || 0);
}

export async function incrementSentToday(by = 1) {
  const key = k.sentToday(todayKey());
  const n = await redis().incrby(key, by);
  if (n === by) await redis().expire(key, 2 * 24 * 60 * 60);
  return n;
}

// ── Quality-rating cache (avoid hammering Meta on every tick) ─────────

export async function getCachedQuality() {
  const h = await redis().hgetall(QUALITY_CACHE);
  if (!h || !h.rating || Date.now() - Number(h.checkedAt || 0) > QUALITY_CACHE_TTL * 1000) return null;
  return h.rating;
}

export async function setCachedQuality(rating) {
  await redis().hset(QUALITY_CACHE, { rating, checkedAt: String(Date.now()) });
}
