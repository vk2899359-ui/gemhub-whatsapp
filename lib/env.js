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
  },

  LOG_MAX_ENTRIES: 2000,
  CONVERSATION_MAX_TURNS: 10, // 10 turns => 20 stored messages
};

// Lazy secret getters (throw only when used, with a clear message).
export const secrets = {
  get SHOPIFY_TOKEN() {
    return required('SHOPIFY_TOKEN');
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
};
