// Zoho CRM OAuth token provider — mirrors lib/shopify-token.js's pattern.
// Uses a "Self Client" refresh token (generated once, manually, at Zoho's
// API Console — see README) to mint short-lived access tokens on demand,
// cached in Redis and auto-refreshed.
import { CONFIG, secrets, isZohoConfigured } from './env.js';
import { redis } from './redis.js';
import { fetchWithRetry } from './http.js';

const CACHE_KEY = 'zoho:access_token';
const REFRESH_BUFFER_SEC = 120;

let memo = null;

function stillValid(record) {
  return record && record.token && record.expiresAt > Date.now() + REFRESH_BUFFER_SEC * 1000;
}

export async function getZohoAccessToken({ forceRefresh = false } = {}) {
  if (!isZohoConfigured()) {
    throw new Error('Zoho is not configured — set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN');
  }
  if (!forceRefresh && stillValid(memo)) return memo.token;

  if (!forceRefresh) {
    try {
      const cached = await redis().get(CACHE_KEY);
      const parsed = typeof cached === 'string' ? JSON.parse(cached) : cached;
      if (stillValid(parsed)) {
        memo = parsed;
        return parsed.token;
      }
    } catch {
      /* fall through to a fresh exchange */
    }
  }
  return exchangeToken();
}

async function exchangeToken() {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: secrets.ZOHO_REFRESH_TOKEN,
    client_id: secrets.ZOHO_CLIENT_ID,
    client_secret: secrets.ZOHO_CLIENT_SECRET,
  });

  const res = await fetchWithRetry(
    `${CONFIG.ZOHO.ACCOUNTS_BASE}/oauth/v2/token`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() },
    { attempts: 3, baseDelayMs: 600, label: 'zoho:token' }
  );
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(`Zoho token refresh failed (${res.status}): ${JSON.stringify(json).slice(0, 200)}`);
  }

  const expiresInSec = Number(json.expires_in) || 3600;
  const record = { token: json.access_token, expiresAt: Date.now() + expiresInSec * 1000 };
  memo = record;
  try {
    await redis().set(CACHE_KEY, JSON.stringify(record), { ex: Math.max(60, expiresInSec - REFRESH_BUFFER_SEC) });
  } catch {
    /* non-fatal */
  }
  return record.token;
}
