// Builders for each WhatsApp message template. These MUST correspond
// exactly to templates approved in the Meta WhatsApp Manager. The exact
// body text and variable order for submission is documented in README.md.
import { CONFIG } from './env.js';

const LANG = CONFIG.DEFAULT_TEMPLATE_LANG;

// WhatsApp rejects template body parameters that contain newlines, tabs,
// or 4+ consecutive spaces. Sanitise every dynamic value.
function clean(value, fallback = '-') {
  const s = value === null || value === undefined ? '' : String(value);
  const out = s
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {4,}/g, '   ')
    .trim();
  return out || fallback;
}

function textParams(...values) {
  return values.map((v) => ({ type: 'text', text: clean(v) }));
}

export const TEMPLATE_NAMES = {
  ABANDONED_CART_1: 'abandoned_cart_1',
  ABANDONED_CART_2: 'abandoned_cart_2',
  COD_CONFIRMATION: 'cod_confirmation',
  ORDER_PAID: 'order_paid',
  ORDER_SHIPPED: 'order_shipped',
};

/** First abandoned-cart nudge (60 min). Vars: name, product, recovery URL. */
export function abandonedCart1({ name, product, recoveryUrl }) {
  return {
    name: TEMPLATE_NAMES.ABANDONED_CART_1,
    language: LANG,
    components: [
      { type: 'body', parameters: textParams(name, product, recoveryUrl) },
    ],
  };
}

/** Final abandoned-cart nudge (24 h). Vars: name, product, recovery URL. */
export function abandonedCart2({ name, product, recoveryUrl }) {
  return {
    name: TEMPLATE_NAMES.ABANDONED_CART_2,
    language: LANG,
    components: [
      { type: 'body', parameters: textParams(name, product, recoveryUrl) },
    ],
  };
}

/**
 * COD confirmation with CONFIRM / CANCEL quick-reply buttons.
 * Vars: name, orderNumber, itemsSummary, total.
 */
export function codConfirmation({ name, orderNumber, itemsSummary, total }) {
  return {
    name: TEMPLATE_NAMES.COD_CONFIRMATION,
    language: LANG,
    components: [
      {
        type: 'body',
        parameters: textParams(name, orderNumber, itemsSummary, total),
      },
      {
        type: 'button',
        sub_type: 'quick_reply',
        index: '0',
        parameters: [{ type: 'payload', payload: 'CONFIRM' }],
      },
      {
        type: 'button',
        sub_type: 'quick_reply',
        index: '1',
        parameters: [{ type: 'payload', payload: 'CANCEL' }],
      },
    ],
  };
}

/** Order paid / confirmed. Vars: name, orderNumber, total. */
export function orderPaid({ name, orderNumber, total }) {
  return {
    name: TEMPLATE_NAMES.ORDER_PAID,
    language: LANG,
    components: [
      { type: 'body', parameters: textParams(name, orderNumber, total) },
    ],
  };
}

/**
 * Shipped notification.
 * Vars: name, orderNumber, courier, trackingNumber, trackingUrl.
 */
export function orderShipped({
  name,
  orderNumber,
  courier,
  trackingNumber,
  trackingUrl,
}) {
  return {
    name: TEMPLATE_NAMES.ORDER_SHIPPED,
    language: LANG,
    components: [
      {
        type: 'body',
        parameters: textParams(
          name,
          orderNumber,
          courier,
          trackingNumber,
          trackingUrl
        ),
      },
    ],
  };
}
