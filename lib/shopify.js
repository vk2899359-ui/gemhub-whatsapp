// Shopify Admin API client: HMAC verification, product search (for the AI
// assistant), abandoned-checkout listing, order tagging & cancellation,
// and webhook registration.
import crypto from 'node:crypto';
import { CONFIG, secrets } from './env.js';
import { fetchWithRetry } from './http.js';

function restUrl(path) {
  return `https://${CONFIG.SHOPIFY_STORE}/admin/api/${CONFIG.SHOPIFY_API_VERSION}/${path}`;
}
function graphqlUrl() {
  return `https://${CONFIG.SHOPIFY_STORE}/admin/api/${CONFIG.SHOPIFY_API_VERSION}/graphql.json`;
}

function authHeaders(extra = {}) {
  return {
    'X-Shopify-Access-Token': secrets.SHOPIFY_TOKEN,
    'Content-Type': 'application/json',
    ...extra,
  };
}

// ── Webhook HMAC verification ────────────────────────────────────────

/**
 * @param {Buffer} rawBody raw request body (bytes)
 * @param {string} hmacHeader value of X-Shopify-Hmac-Sha256
 * @returns {boolean}
 */
export function verifyShopifyHmac(rawBody, hmacHeader) {
  if (!hmacHeader) return false;
  const digest = crypto
    .createHmac('sha256', secrets.SHOPIFY_API_SECRET)
    .update(rawBody)
    .digest('base64');
  const a = Buffer.from(digest);
  const b = Buffer.from(hmacHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ── GraphQL helper ───────────────────────────────────────────────────

async function graphql(query, variables) {
  const res = await fetchWithRetry(
    graphqlUrl(),
    {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ query, variables }),
    },
    { attempts: 3, baseDelayMs: 600, label: 'shopify:graphql' }
  );
  const json = await res.json();
  if (json.errors) {
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

// ── Product search (used by the Claude assistant) ────────────────────

/**
 * Returns a concise, human-readable summary of up to 5 matching products.
 * Never invents data — reports only what Shopify returns.
 */
export async function searchProducts(queryText) {
  const data = await graphql(
    `
      query ($q: String!) {
        products(first: 5, query: $q) {
          edges {
            node {
              title
              handle
              status
              totalInventory
              onlineStoreUrl
              priceRangeV2 {
                minVariantPrice { amount currencyCode }
                maxVariantPrice { amount currencyCode }
              }
              variants(first: 1) {
                edges { node { availableForSale } }
              }
            }
          }
        }
      }
    `,
    { q: queryText }
  );

  const edges = data?.products?.edges || [];
  if (edges.length === 0) {
    return `No products found matching "${queryText}".`;
  }

  const lines = edges.map(({ node }) => {
    const min = node.priceRangeV2?.minVariantPrice;
    const max = node.priceRangeV2?.maxVariantPrice;
    let price = 'price on request';
    if (min?.amount) {
      const cur = min.currencyCode || 'INR';
      price =
        max?.amount && max.amount !== min.amount
          ? `${cur} ${min.amount}–${max.amount}`
          : `${cur} ${min.amount}`;
    }
    const inStock =
      node.variants?.edges?.[0]?.node?.availableForSale &&
      node.status === 'ACTIVE'
        ? 'in stock'
        : 'currently unavailable';
    const url =
      node.onlineStoreUrl ||
      `https://${CONFIG.SHOPIFY_STORE.replace('.myshopify.com', '')}/products/${node.handle}`;
    return `• ${node.title} — ${price}, ${inStock}. ${url}`;
  });

  return `Matching products:\n${lines.join('\n')}`;
}

// ── Abandoned checkouts ──────────────────────────────────────────────

/**
 * List abandoned checkouts created within the last `sinceHours` hours.
 * Requires the read_checkouts scope.
 */
export async function listAbandonedCheckouts({ sinceHours = 72, limit = 250 } = {}) {
  const createdMin = new Date(
    Date.now() - sinceHours * 60 * 60 * 1000
  ).toISOString();
  const params = new URLSearchParams({
    status: 'open',
    limit: String(limit),
    created_at_min: createdMin,
  });
  const res = await fetchWithRetry(
    restUrl(`checkouts.json?${params.toString()}`),
    { method: 'GET', headers: authHeaders() },
    { attempts: 3, baseDelayMs: 600, label: 'shopify:checkouts' }
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Shopify checkouts fetch failed (${res.status}): ${t}`);
  }
  const json = await res.json();
  return json.checkouts || [];
}

// ── Orders: lookup, tagging, cancellation ────────────────────────────

export async function getOrder(orderId) {
  const res = await fetchWithRetry(
    restUrl(`orders/${orderId}.json`),
    { method: 'GET', headers: authHeaders() },
    { attempts: 3, baseDelayMs: 600, label: 'shopify:getOrder' }
  );
  if (!res.ok) return null;
  const json = await res.json();
  return json.order || null;
}

/** Append tags to an order (preserving existing ones). */
export async function addOrderTags(orderId, newTags) {
  const order = await getOrder(orderId);
  const existing = (order?.tags || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const merged = Array.from(new Set([...existing, ...newTags]));

  const res = await fetchWithRetry(
    restUrl(`orders/${orderId}.json`),
    {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify({
        order: { id: Number(orderId), tags: merged.join(', ') },
      }),
    },
    { attempts: 3, baseDelayMs: 600, label: 'shopify:tagOrder' }
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Failed to tag order ${orderId} (${res.status}): ${t}`);
  }
  return merged;
}

/** Cancel an order (COD cancellation flow). */
export async function cancelOrder(orderId, { reason = 'customer' } = {}) {
  const res = await fetchWithRetry(
    restUrl(`orders/${orderId}/cancel.json`),
    {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ reason, email: false }),
    },
    { attempts: 3, baseDelayMs: 600, label: 'shopify:cancelOrder' }
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Failed to cancel order ${orderId} (${res.status}): ${t}`);
  }
  return true;
}

// ── Webhook registration (one-time setup) ────────────────────────────

const WEBHOOK_TOPICS = [
  'checkouts/create',
  'checkouts/update',
  'orders/create',
  'orders/paid',
  'orders/cancelled',
  'fulfillments/create',
];

export async function registerWebhooks(callbackUrl) {
  const results = [];
  for (const topic of WEBHOOK_TOPICS) {
    try {
      const res = await fetchWithRetry(
        restUrl('webhooks.json'),
        {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            webhook: { topic, address: callbackUrl, format: 'json' },
          }),
        },
        { attempts: 2, baseDelayMs: 500, label: `shopify:webhook:${topic}` }
      );
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        results.push({ topic, status: 'created', id: json?.webhook?.id });
      } else if (
        res.status === 422 &&
        JSON.stringify(json).toLowerCase().includes('already been taken')
      ) {
        results.push({ topic, status: 'already_exists' });
      } else {
        results.push({ topic, status: 'error', error: json });
      }
    } catch (err) {
      results.push({ topic, status: 'error', error: err.message });
    }
  }
  return results;
}

export { WEBHOOK_TOPICS };
