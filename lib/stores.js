// Redis-backed stores for abandoned-cart tracking and COD order mapping.
import { redis } from './redis.js';
import { CONFIG } from './env.js';

const ACTIVE_SET = 'checkouts:active';
const checkoutKey = (id) => `checkout:${id}`;
const codKey = (phone) => `cod:${phone}`;

// ── Abandoned checkout tracking ──────────────────────────────────────

/**
 * Insert or update a tracked checkout. Preserves follow-up progress on
 * updates; drops from tracking once an order is placed (see recoverCheckout).
 *
 * @param {object} record { id, phone, name, product, recoveryUrl, createdAt }
 */
export async function upsertCheckout(record) {
  if (!record.id) return;
  const r = redis();
  const key = checkoutKey(record.id);

  const existingRaw = await r.get(key);
  const existing = parse(existingRaw);

  // If it was already recovered, don't resurrect it.
  if (existing?.recovered) return;

  const createdAt = existing?.createdAt || record.createdAt || Date.now();
  const merged = {
    id: String(record.id),
    phone: record.phone ?? existing?.phone ?? null,
    name: record.name ?? existing?.name ?? 'there',
    product: record.product ?? existing?.product ?? 'your selection',
    recoveryUrl: record.recoveryUrl ?? existing?.recoveryUrl ?? null,
    createdAt,
    followups: existing?.followups ?? 0,
    // First nudge is due 60 minutes after checkout creation.
    nextDueAt: existing?.nextDueAt ?? createdAt + 60 * 60 * 1000,
    recovered: false,
  };

  await r.set(key, JSON.stringify(merged), { ex: CONFIG.TTL.CHECKOUT });
  await r.sadd(ACTIVE_SET, merged.id);
}

/** Mark a checkout as recovered (an order was placed) and stop nudging. */
export async function recoverCheckout(checkoutId) {
  if (!checkoutId) return;
  const r = redis();
  const key = checkoutKey(checkoutId);
  const existing = parse(await r.get(key));
  if (existing) {
    existing.recovered = true;
    await r.set(key, JSON.stringify(existing), { ex: CONFIG.TTL.CHECKOUT });
  }
  await r.srem(ACTIVE_SET, String(checkoutId));
}

/** All checkout ids currently being tracked for abandonment. */
export async function activeCheckoutIds() {
  return (await redis().smembers(ACTIVE_SET)) || [];
}

export async function getCheckout(id) {
  return parse(await redis().get(checkoutKey(id)));
}

/** Persist follow-up progress after a nudge is sent. */
export async function saveCheckout(record) {
  await redis().set(checkoutKey(record.id), JSON.stringify(record), {
    ex: CONFIG.TTL.CHECKOUT,
  });
}

/** Remove a checkout from active tracking (done / unreachable). */
export async function deactivateCheckout(id) {
  await redis().srem(ACTIVE_SET, String(id));
}

// ── COD order mapping (phone -> order awaiting confirmation) ──────────

export async function setCodPending(phone, data) {
  await redis().set(codKey(phone), JSON.stringify(data), {
    ex: CONFIG.TTL.COD,
  });
}

export async function getCodPending(phone) {
  return parse(await redis().get(codKey(phone)));
}

export async function clearCodPending(phone) {
  await redis().del(codKey(phone));
}

function parse(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}
