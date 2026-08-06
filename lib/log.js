// Debug logging of every send/receive to Redis. Best-effort: logging
// must never throw into the caller's flow.
import { redis } from './redis.js';
import { CONFIG } from './env.js';

const LOG_KEY = 'log:events';

/**
 * @param {'in'|'out'|'system'} direction
 * @param {object} data arbitrary structured payload
 */
export async function logEvent(direction, data) {
  try {
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      direction,
      ...data,
    });
    const r = redis();
    await r.lpush(LOG_KEY, entry);
    await r.ltrim(LOG_KEY, 0, CONFIG.LOG_MAX_ENTRIES - 1);
  } catch (err) {
    console.error('[logEvent] failed', err?.message);
  }
}

export const logIncoming = (data) => logEvent('in', data);
export const logOutgoing = (data) => logEvent('out', data);
export const logSystem = (data) => logEvent('system', data);
