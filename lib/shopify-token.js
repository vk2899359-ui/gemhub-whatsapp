// Shopify Admin API token provider for Dev Dashboard apps.
//
// Dev Dashboard apps no longer expose a static `shpat_` token. Instead we
// mint a short-lived (24h) Admin API token on demand via the OAuth
// client_credentials grant (client_id + client_secret of the app, which must
// live in the same Shopify organization as the store). The token is cached in
// Redis (shared across serverless invocations) and in-process, and refreshed
// automatically before it expires.
//
// Docs: https://shopify.dev/docs/apps/build/dev-dashboard/get-api-access-tokens
import { CONFIG, secrets } from './env.js';
import { redis } from './redis.js';
import { fetchWithRetry } from './http.js';

const CACHE_KEY = 'shopify:admin_token';
const REFRESH_BUFFER_SEC = 300; // refresh 5 min before actual expiry

// Warm-lambda in-process cache to avoid a Redis hit on every call.
let memo = null; // { token, expiresAt (ms), scope }

function stillValid(record) {
  return (
    record &&
    record.token &&
    record.expiresAt > Date.now() + REFRESH_BUFFER_SEC * 1000
  );
}

/**
 * Returns a valid Admin API access token, minting/refreshing as needed.
 * @param {{forceRefresh?: boolean}} [opts]
 */
export async function getShopifyAccessToken({ forceRefresh = false } = {}) {
  // Optional static override (e.g. a legacy shpat_ token supplied via env).
  if (process.env.SHOPIFY_TOKEN) return process.env.SHOPIFY_TOKEN;

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
      // Redis miss/parse error -> fall through to a fresh exchange.
    }
  }

  return exchangeToken();
}

async function exchangeToken() {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: secrets.SHOPIFY_API_KEY,
    client_secret: secrets.SHOPIFY_API_SECRET,
  });

  const res = await fetchWithRetry(
    `https://${CONFIG.SHOPIFY_STORE}/admin/oauth/access_token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    },
    { attempts: 3, baseDelayMs: 600, label: 'shopify:token' }
  );

  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(
      `Shopify client_credentials exchange failed (${res.status}): ${JSON.stringify(json).slice(0, 200)}`
    );
  }

  const expiresInSec = Number(json.expires_in) || 86399;
  const record = {
    token: json.access_token,
    expiresAt: Date.now() + expiresInSec * 1000,
    scope: json.scope || '',
  };
  memo = record;

  try {
    await redis().set(CACHE_KEY, JSON.stringify(record), {
      ex: Math.max(60, expiresInSec - REFRESH_BUFFER_SEC),
    });
  } catch {
    // Non-fatal: token still returned; a cache miss just means we re-mint.
  }

  return record.token;
}
