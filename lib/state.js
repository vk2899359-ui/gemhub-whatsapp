// Conversation state: 24-hour service window, conversation memory,
// escalation flag, failed-intent counter, and webhook de-duplication.
import { redis } from './redis.js';
import { CONFIG } from './env.js';

const k = {
  dedupe: (id) => `wa:msg:${id}`,
  window: (phone) => `window:${phone}`,
  conv: (phone) => `conv:${phone}`,
  escalation: (phone) => `escalation:${phone}`,
  intentFail: (phone) => `intents:fail:${phone}`,
  adSource: (phone) => `adsrc:${phone}`,
  lastProducts: (phone) => `lastprod:${phone}`,
  profileName: (phone) => `profile:${phone}`,
  handoverActive: 'handover:active',
  leadMessage: (wamid) => `handover:msg:${wamid}`,
};

/**
 * Atomically claim a message id. Returns true the first time a given id is
 * seen, false on WhatsApp retries (so we process each message exactly once).
 */
export async function claimMessage(messageId) {
  if (!messageId) return true;
  const res = await redis().set(k.dedupe(messageId), '1', {
    nx: true,
    ex: CONFIG.TTL.DEDUPE,
  });
  return res === 'OK';
}

/** Mark that the customer just messaged us -> opens the 24h service window. */
export async function touchWindow(phone) {
  await redis().set(k.window(phone), Date.now().toString(), {
    ex: CONFIG.TTL.WINDOW,
  });
}

/** True if we are still inside the 24-hour customer service window. */
export async function isWithinWindow(phone) {
  const v = await redis().get(k.window(phone));
  return Boolean(v);
}

/** Seconds remaining in the 24h window, or null if closed/expired. */
export async function getWindowTtlSeconds(phone) {
  try {
    const ttl = await redis().ttl(k.window(phone));
    return ttl > 0 ? ttl : null;
  } catch {
    return null;
  }
}

// ── Conversation memory (last N turns) ───────────────────────────────
// Stored as a Redis list of JSON {role, content}. Newest pushed to the
// right; we keep the last 2*N entries (N turns).

export async function loadHistory(phone) {
  const raw = await redis().lrange(k.conv(phone), 0, -1);
  return raw
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

export async function appendTurns(phone, turns) {
  const r = redis();
  const key = k.conv(phone);
  for (const t of turns) {
    await r.rpush(key, JSON.stringify(t));
  }
  // Keep only the last N turns (2 messages per turn).
  await r.ltrim(key, -CONFIG.CONVERSATION_MAX_TURNS * 2, -1);
  await r.expire(key, CONFIG.TTL.CONVERSATION);
}

// ── Escalation / human handover ──────────────────────────────────────
// The escalation key doubles as the "handover record": while it exists the
// bot stays quiet for that customer. Stored as JSON so we can carry the
// reason, when it started, and the wamid of the lead message sent to the
// sales agent (used to resolve his reply-to-release). TTL is a SLIDING 24h
// window — touchHandover() refreshes it on every customer message received
// while escalated, so it auto-releases after 24h of no customer activity.

export async function isEscalated(phone) {
  return Boolean(await redis().get(k.escalation(phone)));
}

/**
 * @param {string} phone
 * @param {string|object} reasonOrRecord plain reason string, or a record object
 */
export async function setEscalated(phone, reasonOrRecord) {
  const record =
    typeof reasonOrRecord === 'string' || !reasonOrRecord
      ? { reason: reasonOrRecord || 'escalated', at: Date.now() }
      : { at: Date.now(), ...reasonOrRecord };
  await redis().set(k.escalation(phone), JSON.stringify(record), {
    ex: CONFIG.TTL.HANDOVER,
  });
  return record;
}

/** Full handover record ({reason, at, profileName, leadMessageId, ...}) or null. */
export async function getEscalationRecord(phone) {
  const raw = await redis().get(k.escalation(phone));
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return { reason: String(raw), at: null };
  }
}

/** Slide the 24h auto-release window forward (call on customer activity). */
export async function touchHandover(phone) {
  try {
    await redis().expire(k.escalation(phone), CONFIG.TTL.HANDOVER);
  } catch {
    /* non-fatal */
  }
}

export async function clearEscalation(phone) {
  await redis().del(k.escalation(phone));
  await redis().srem(k.handoverActive, phone);
}

// ── Active-handover set (for "release all" and future dashboard use) ──

export async function addActiveHandover(phone) {
  await redis().sadd(k.handoverActive, phone);
}

export async function removeActiveHandover(phone) {
  await redis().srem(k.handoverActive, phone);
}

export async function listActiveHandovers() {
  return (await redis().smembers(k.handoverActive)) || [];
}

// ── Lead-message -> customer mapping (for reply-to-release) ───────────
// When the sales agent swipe-replies to the lead notification, WhatsApp
// echoes the original message id in `context.id`; this maps it back to the
// customer's phone number.

export async function setLeadMessageCustomer(wamid, phone) {
  if (!wamid) return;
  await redis().set(k.leadMessage(wamid), phone, { ex: CONFIG.TTL.HANDOVER });
}

export async function getLeadMessageCustomer(wamid) {
  if (!wamid) return null;
  return (await redis().get(k.leadMessage(wamid))) || null;
}

// ── Remembered WhatsApp display name (per phone) ───────────────────────

export async function setProfileName(phone, name) {
  if (!name) return;
  try {
    await redis().set(k.profileName(phone), name, { ex: CONFIG.TTL.PROFILE_NAME });
  } catch {
    /* non-fatal */
  }
}

export async function getProfileName(phone) {
  try {
    return (await redis().get(k.profileName(phone))) || null;
  } catch {
    return null;
  }
}

// ── Failed-intent counter ────────────────────────────────────────────

export async function bumpIntentFailures(phone, by = 1) {
  const r = redis();
  const key = k.intentFail(phone);
  const n = await r.incrby(key, by);
  await r.expire(key, CONFIG.TTL.INTENT_FAIL);
  return n;
}

export async function resetIntentFailures(phone) {
  await redis().del(k.intentFail(phone));
}

// ── Ad-sourced conversation tag ──────────────────────────────────────
// Set when the first message matches the Google Ads starter text, so we can
// open with a qualifying question instead of a generic greeting.

/** @param {'meta'|'google'} platform */
export async function setAdSourced(phone, platform) {
  await redis().set(k.adSource(phone), platform || '1', { ex: CONFIG.TTL.AD_SOURCE });
}

export async function isAdSourced(phone) {
  return Boolean(await redis().get(k.adSource(phone)));
}

/** @returns {Promise<'meta'|'google'|null>} */
export async function getAdPlatform(phone) {
  const v = await redis().get(k.adSource(phone));
  return v === 'meta' || v === 'google' ? v : null;
}

// ── Last shown products (shortlist) ──────────────────────────────────
// Remember the pieces we last showed so a product pick from the list can be
// resolved without re-searching Shopify.

export async function setLastProducts(phone, products) {
  try {
    await redis().set(k.lastProducts(phone), JSON.stringify(products || []), {
      ex: CONFIG.TTL.LAST_PRODUCTS,
    });
  } catch {
    /* non-fatal */
  }
}

export async function getLastProducts(phone) {
  try {
    const raw = await redis().get(k.lastProducts(phone));
    if (!raw) return [];
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return [];
  }
}
