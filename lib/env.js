// Centralised configuration. Reads from process.env with sensible
// defaults. Never hardcode secrets — everything sensitive comes from env.

const env = process.env;

function required(name) {
  const v = env[name];
  if (!v) {
    // Do not crash at import time (serverless cold starts import everything);
    // surface a clear error only when the value is actually needed.
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

export const CONFIG = {
  PUBLIC_BASE_URL: (env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),

  // Shopify
  SHOPIFY_STORE: env.SHOPIFY_STORE || 'vbvidr-u9.myshopify.com',
  SHOPIFY_API_VERSION: env.SHOPIFY_API_VERSION || '2024-10',

  // WhatsApp / Meta
  WABA_ID: env.WABA_ID || '1747154966614614',
  PHONE_NUMBER_ID: env.PHONE_NUMBER_ID || '1186838137853897',
  VERIFY_TOKEN: env.VERIFY_TOKEN || 'gemhub2026',
  GRAPH_API_VERSION: env.GRAPH_API_VERSION || 'v21.0',

  // Anthropic
  ANTHROPIC_MODEL: env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',

  // Storefront currency symbol for prices shown to customers
  CURRENCY: env.STORE_CURRENCY || '₹',

  // Native WhatsApp catalog / product messages. When the Shopify catalogue is
  // connected to the WABA and USE_CATALOG is on, the bot sends interactive
  // product / product_list messages; otherwise it sends real image messages.
  USE_CATALOG: env.WHATSAPP_USE_CATALOG === 'true',
  CATALOG_ID: env.WHATSAPP_CATALOG_ID || '',

  // Showroom facts used by location / directions / escalation messages.
  SHOWROOM: {
    // Verified against the building's own listing (Green Wood Plaza, Sector
    // 45, Gurugram) — the previous default was a same-neighborhood point
    // ~1.5-2km off, so the shared WhatsApp location pin dropped nowhere near
    // the actual storefront even though the address text was correct.
    latitude: Number(env.SHOWROOM_LAT || '28.444688'),
    longitude: Number(env.SHOWROOM_LNG || '77.059479'),
    name: 'GemHub — Fine Jewellery',
    address: '2nd Floor, Unit 201, Greenwood Plaza, Sector 45, Gurugram',
    hours: '10 AM – 7 PM, all 7 days',
    phone: '+91 84485 61821',
    email: 'care@gemhub.in',
    mapsUrl:
      'https://www.google.com/maps/search/?api=1&query=' +
      encodeURIComponent('Greenwood Plaza, Sector 45, Gurugram'),
  },

  // Default language for message templates
  DEFAULT_TEMPLATE_LANG: env.DEFAULT_TEMPLATE_LANG || 'en',

  // Default country dialing code applied to bare 10-digit numbers
  DEFAULT_COUNTRY_CODE: env.DEFAULT_COUNTRY_CODE || '91',

  // TTLs (seconds)
  TTL: {
    DEDUPE: 3 * 24 * 60 * 60, // 3 days
    CONVERSATION: 24 * 60 * 60, // 24 hours
    WINDOW: 24 * 60 * 60, // 24-hour service window
    ESCALATION: 7 * 24 * 60 * 60, // 7 days
    CHECKOUT: 7 * 24 * 60 * 60, // 7 days
    COD: 7 * 24 * 60 * 60, // 7 days
    INTENT_FAIL: 24 * 60 * 60, // 24 hours
    CATALOG: 24 * 60 * 60, // 1 day (cached WABA catalog id)
    AD_SOURCE: 30 * 24 * 60 * 60, // 30 days (ad-sourced conversation tag)
    LAST_PRODUCTS: 24 * 60 * 60, // 24 hours (shortlist for product picks)
    PROFILE_NAME: 90 * 24 * 60 * 60, // 90 days (remembered WhatsApp display name)
    // Human handover: sliding 24h window, refreshed on every customer message
    // while escalated -> auto-releases after 24h of no customer activity.
    HANDOVER: 24 * 60 * 60,
  },

  LOG_MAX_ENTRIES: 2000,
  CONVERSATION_MAX_TURNS: 10, // 10 turns => 20 stored messages

  // Human handover target — the sales agent customers get handed off to.
  SALES_AGENT: {
    name: env.SALES_AGENT_NAME || 'Keshav',
    phone: env.SALES_AGENT_PHONE || '+91 85957 72402',
  },

  // Bulk campaign guardrails — all overridable via env, conservative defaults.
  CAMPAIGNS: {
    DEFAULT_THROTTLE_PER_SEC: Number(env.CAMPAIGN_DEFAULT_THROTTLE_PER_SEC || 1),
    DEFAULT_COOLDOWN_DAYS: Number(env.CAMPAIGN_DEFAULT_COOLDOWN_DAYS || 7),
    DAILY_CAP: Number(env.CAMPAIGN_DAILY_CAP || 1000),
    TEST_SEND_REQUIRED_OVER: Number(env.CAMPAIGN_TEST_SEND_REQUIRED_OVER || 100),
    // Vercel's hard function limit is 60s. A tick budget too close to that
    // leaves no real buffer for the self-chain trigger to fire before the
    // invocation is killed (waitUntil extends the invocation, it doesn't
    // bypass the hard cap) — found live in the Zoho sync at 45s. 20s leaves
    // a genuine ~40s/67% buffer.
    TICK_BUDGET_MS: Number(env.CAMPAIGN_TICK_BUDGET_MS || 20000),
    // Owner/ops number that receives test sends and safety alerts (quality
    // drops, kill switch trips). Defaults to the number used throughout setup.
    ALERT_PHONE: env.CAMPAIGN_ALERT_PHONE || '+91 7906081795',
  },

  // Zoho CRM (optional — live sync only activates once all three are set).
  ZOHO: {
    ACCOUNTS_BASE: env.ZOHO_ACCOUNTS_BASE || 'https://accounts.zoho.in',
    API_BASE: env.ZOHO_API_BASE || 'https://www.zohoapis.in',
  },
};

// Lazy secret getters (throw only when used, with a clear message).
export const secrets = {
  // Dev Dashboard app credentials. The Admin API token is minted on demand
  // via the client_credentials grant (see lib/shopify-token.js); an optional
  // static SHOPIFY_TOKEN env var can still override it if ever needed.
  get SHOPIFY_API_KEY() {
    return required('SHOPIFY_API_KEY');
  },
  get SHOPIFY_API_SECRET() {
    return required('SHOPIFY_API_SECRET');
  },
  get META_TOKEN() {
    return required('META_TOKEN');
  },
  get META_APP_SECRET() {
    return env.META_APP_SECRET || '';
  },
  get ANTHROPIC_API_KEY() {
    return required('ANTHROPIC_API_KEY');
  },
  get REGISTER_SECRET() {
    return required('REGISTER_SECRET');
  },
  get CRON_SECRET() {
    return env.CRON_SECRET || '';
  },
  get DASHBOARD_PASSWORD() {
    return required('DASHBOARD_PASSWORD');
  },
  // Campaign self-chain / cron trigger auth (shared with CRON_SECRET's role).
  get CAMPAIGN_SECRET() {
    return required('CAMPAIGN_SECRET');
  },
  // Zoho is optional: read raw (no throw) so callers can check configuration
  // via isZohoConfigured() before touching the sync endpoint.
  get ZOHO_CLIENT_ID() {
    return env.ZOHO_CLIENT_ID || '';
  },
  get ZOHO_CLIENT_SECRET() {
    return env.ZOHO_CLIENT_SECRET || '';
  },
  get ZOHO_REFRESH_TOKEN() {
    return env.ZOHO_REFRESH_TOKEN || '';
  },
};

export function isZohoConfigured() {
  return Boolean(env.ZOHO_CLIENT_ID && env.ZOHO_CLIENT_SECRET && env.ZOHO_REFRESH_TOKEN);
}
