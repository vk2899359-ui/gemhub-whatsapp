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

// ── Escalation to human ──────────────────────────────────────────────

export async function isEscalated(phone) {
  return Boolean(await redis().get(k.escalation(phone)));
}

export async function setEscalated(phone, reason) {
  await redis().set(k.escalation(phone), reason || 'escalated', {
    ex: CONFIG.TTL.ESCALATION,
  });
}

export async function clearEscalation(phone) {
  await redis().del(k.escalation(phone));
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

export async function setAdSourced(phone) {
  await redis().set(k.adSource(phone), '1', { ex: CONFIG.TTL.AD_SOURCE });
}

export async function isAdSourced(phone) {
  return Boolean(await redis().get(k.adSource(phone)));
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
