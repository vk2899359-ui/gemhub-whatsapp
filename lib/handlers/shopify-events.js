// Routes verified Shopify webhook events to the right WhatsApp flow.
import { CONFIG } from '../env.js';
import { normalizePhone } from '../phone.js';
import { sendTemplate } from '../whatsapp.js';
import {
  codConfirmation,
  orderPaid,
  orderShipped,
} from '../templates.js';
import {
  upsertCheckout,
  recoverCheckout,
  setCodPending,
} from '../stores.js';
import { recordOrderEvent } from '../conversations.js';
import { logSystem } from '../log.js';

export async function handleShopifyEvent(topic, payload) {
  switch (topic) {
    case 'checkouts/create':
    case 'checkouts/update':
      return onCheckout(payload);
    case 'orders/create':
      return onOrderCreate(payload);
    case 'orders/paid':
      return onOrderPaid(payload);
    case 'orders/cancelled':
      return onOrderCancelled(payload);
    case 'fulfillments/create':
      return onFulfillmentCreate(payload);
    default:
      await logSystem({ event: 'shopify_unhandled_topic', topic });
      return;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function customerName(entity) {
  const first =
    entity?.customer?.first_name ||
    entity?.billing_address?.first_name ||
    entity?.shipping_address?.first_name ||
    entity?.customer?.default_address?.first_name;
  return (first && String(first).trim()) || 'there';
}

function customerPhone(entity) {
  const candidates = [
    entity?.phone,
    entity?.customer?.phone,
    entity?.shipping_address?.phone,
    entity?.billing_address?.phone,
    entity?.customer?.default_address?.phone,
  ];
  for (const c of candidates) {
    const n = normalizePhone(c);
    if (n) return n;
  }
  return null;
}

function money(amount, currency) {
  if (amount === null || amount === undefined) return 'N/A';
  const cur = currency || 'INR';
  const symbol = cur === 'INR' ? '₹' : `${cur} `;
  return `${symbol}${amount}`;
}

function itemsSummary(lineItems = []) {
  const parts = lineItems
    .slice(0, 6)
    .map((li) => `${li.quantity}x ${li.title}`.trim());
  let summary = parts.join(', ');
  if (lineItems.length > 6) summary += `, +${lineItems.length - 6} more`;
  return summary || 'your items';
}

function isCod(order) {
  const gateways = (order?.payment_gateway_names || []).join(' ').toLowerCase();
  const gateway = String(order?.gateway || '').toLowerCase();
  const hay = `${gateways} ${gateway}`;
  return /cash on delivery|\bcod\b/.test(hay);
}

function orderLabel(order) {
  return order?.name || (order?.order_number ? `#${order.order_number}` : `#${order?.id}`);
}

// ── Event handlers ───────────────────────────────────────────────────

async function onCheckout(checkout) {
  const phone = customerPhone(checkout);
  const product =
    checkout?.line_items?.[0]?.title ||
    checkout?.line_items?.[0]?.name ||
    'your selection';
  const record = {
    id: checkout.id,
    phone,
    name: customerName(checkout),
    product,
    recoveryUrl: checkout.abandoned_checkout_url || null,
    createdAt: checkout.created_at
      ? new Date(checkout.created_at).getTime()
      : Date.now(),
  };
  await upsertCheckout(record);
  await logSystem({
    event: 'checkout_tracked',
    checkoutId: checkout.id,
    hasPhone: Boolean(phone),
  });
}

async function onOrderCreate(order) {
  // An order was placed -> stop abandoned-cart nudges for its checkout.
  const cid = order.checkout_id || order.checkout_token;
  if (cid) await recoverCheckout(cid);

  const label = orderLabel(order);
  const total = money(order.total_price, order.currency);
  const cod = isCod(order);
  const phone = customerPhone(order);

  if (phone) {
    await recordOrderEvent(phone, {
      kind: 'order_created',
      body: `🧾 Order ${label} placed — ${total}${cod ? ' (Cash on Delivery)' : ''}`,
    });
  }

  if (!cod) {
    await logSystem({ event: 'order_created_prepaid', order: label });
    return;
  }

  if (!phone) {
    await logSystem({
      event: 'cod_no_phone',
      order: label,
      orderId: order.id,
    });
    return;
  }

  await setCodPending(phone, {
    orderId: order.id,
    orderName: label,
    createdAt: Date.now(),
  });

  await sendTemplate(
    phone,
    codConfirmation({
      name: customerName(order),
      orderNumber: label,
      itemsSummary: itemsSummary(order.line_items),
      total,
    })
  );
  await logSystem({ event: 'cod_confirmation_sent', order: label, phone });
}

async function onOrderPaid(order) {
  const phone = customerPhone(order);
  if (!phone) return;
  const total = money(order.total_price, order.currency);
  await sendTemplate(
    phone,
    orderPaid({
      name: customerName(order),
      orderNumber: orderLabel(order),
      total,
    })
  );
  await recordOrderEvent(phone, {
    kind: 'order_paid',
    body: `✅ Payment received for ${orderLabel(order)} — ${total}`,
  });
  await logSystem({ event: 'order_paid_sent', order: orderLabel(order), phone });
}

async function onOrderCancelled(order) {
  // No template required by spec; log for the record. (COD cancellations
  // that we initiate are handled in the inbound flow.)
  await logSystem({ event: 'order_cancelled', order: orderLabel(order) });
}

async function onFulfillmentCreate(fulfillment) {
  const phone =
    normalizePhone(fulfillment?.destination?.phone) ||
    normalizePhone(fulfillment?.order?.phone) ||
    normalizePhone(fulfillment?.order?.customer?.phone);
  if (!phone) {
    await logSystem({
      event: 'fulfillment_no_phone',
      orderId: fulfillment?.order_id,
    });
    return;
  }

  const trackingNumber =
    fulfillment?.tracking_number ||
    fulfillment?.tracking_numbers?.[0] ||
    'N/A';
  const trackingUrl =
    fulfillment?.tracking_url ||
    fulfillment?.tracking_urls?.[0] ||
    'https://gemhub.in';
  const courier = fulfillment?.tracking_company || 'our courier partner';

  // fulfillment.name looks like "#1004.1" -> strip the suffix.
  const orderNumber = (fulfillment?.name || `#${fulfillment?.order_id}`).replace(
    /\.\d+$/,
    ''
  );
  const name =
    fulfillment?.destination?.first_name?.trim() ||
    'there';

  await sendTemplate(
    phone,
    orderShipped({
      name,
      orderNumber,
      courier,
      trackingNumber,
      trackingUrl,
    })
  );
  await recordOrderEvent(phone, {
    kind: 'order_shipped',
    body: `🚚 ${orderNumber} shipped via ${courier} — tracking ${trackingNumber}`,
  });
  await logSystem({
    event: 'order_shipped_sent',
    order: orderNumber,
    phone,
    trackingNumber,
  });
}

export const _internal = { isCod, customerPhone, itemsSummary };
