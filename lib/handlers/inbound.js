// Processes a single inbound WhatsApp message: de-dup, COD buttons, interactive
// reply routing (menus, booking slots, product picks) BY REPLY ID, the AI sales
// consultant (interactive replies), and human escalation.
import {
  sendText,
  markRead,
  sendButtons,
  sendList,
  sendLocation,
  sendCtaUrl,
  sendProductCards,
} from '../whatsapp.js';
import { CONFIG } from '../env.js';
import { logIncoming, logSystem } from '../log.js';
import {
  claimMessage,
  touchWindow,
  loadHistory,
  appendTurns,
  isEscalated,
  touchHandover,
  bumpIntentFailures,
  resetIntentFailures,
  isAdSourced,
  setAdSourced,
  setLastProducts,
  getLastProducts,
  setProfileName,
} from '../state.js';
import { getCodPending, clearCodPending } from '../stores.js';
import { addOrderTags, cancelOrder } from '../shopify.js';
import { generateReply } from '../claude.js';
import { isFromAgent, handleAgentInbound, triggerHandover, AGENT } from '../handover.js';

const S = CONFIG.SHOWROOM;

const HUMAN_REQUEST_RE =
  /\b(human|agent|representative|person|customer care|customer support|talk to (someone|a person)|call me|phone call|manager)\b|इंसान|व्यक्ति|एजेंट|बात कर(ना|ें)|फ़?ोन|call karo|baat kar|insaan/i;

// "Give me a number to call" — distinct from HUMAN_REQUEST_RE (which already
// catches "call me" / bare फ़ोन mentions); this catches asking FOR a number.
const NUMBER_REQUEST_RE =
  /\b(mobile|contact|whatsapp|business)?\s*number\b.{0,20}\b(please|share|send|do|give)\b|\b(share|send|give)\b.{0,10}\bnumber\b|\bmobile\s*no\.?\b|\bcontact\s*no\.?\b|number\s*(do|dedo|bhejo|batao)|नंबर\s*(दो|दे दो|भेजो|शेयर)/i;

// Safety net for things the bot genuinely can't do — the AI is prompted to
// call unable_to_help for these too, but this fast-path guarantees a
// deterministic handover even if the model misses it.
const BUSINESS_ESCALATION_RE =
  /\b(bulk order|wholesale|corporate order|corporate gifting|large order|complaint|refund|payment failed|payment issue|payment problem|fraud|scam|cheated|damaged item|defective item)\b|शिकायत|थोक\s*ऑर्डर|पेमेंट\s*(फेल|इशू|समस्या)|रिफंड|dhoka|paisa wapas|refund chahiye|payment fail/i;

const ESCALATION_THRESHOLD = 3;

const DEFAULT_MENU = [
  { id: 'browse_jewellery', title: 'Browse Jewellery' },
  { id: 'book_visit', title: 'Book Showroom Visit' },
  { id: 'custom_design', title: 'Custom Design' },
];
const AFTER_PRODUCTS_MENU = [
  { id: 'see_more', title: 'See More' },
  { id: 'book_visit', title: 'Book a Visit' },
  { id: 'talk_to_expert', title: 'Talk to Expert' },
];
const SLOTS = ['10:00 AM', '11:30 AM', '1:00 PM', '3:00 PM', '5:00 PM', '6:30 PM'];

// Directives fed to the AI when a menu button is tapped (routed by id). The
// consultant then replies in the customer's language using the right format.
const MENU_INTENT = {
  browse_jewellery:
    "[The customer tapped 'Browse Jewellery'. Ask one quick qualifying question (occasion or category) in their language, then show a few curated pieces.]",
  custom_design:
    "[The customer tapped 'Custom Design'. Briefly explain custom & CAD design and ask what they have in mind — occasion, style, budget — in their language.]",
  see_more: "[The customer tapped 'See More'. Show a few more curated pieces in the same direction as before.]",
};

export async function handleInboundMessage(message, contact) {
  const messageId = message?.id;
  const from = message?.from;
  if (!from) return;

  const fresh = await claimMessage(messageId);
  if (!fresh) {
    await logSystem({ event: 'duplicate_ignored', messageId });
    return;
  }

  const profileName = contact?.profile?.name || 'there';
  await touchWindow(from);
  markRead(messageId);
  if (contact?.profile?.name) await setProfileName(from, contact.profile.name);

  const button = extractButtonPayload(message); // CONFIRM / CANCEL only
  const interactiveId = extractInteractiveId(message);
  const text = extractText(message);

  await logIncoming({ from, messageId, type: message?.type, button, interactiveId, text, profileName });

  // 0) Messages from the sales agent (Keshav) are commands, never customer
  // chat — route separately and stop, regardless of anything else below.
  if (isFromAgent(from)) {
    return handleAgentInbound(message);
  }

  // 1) COD quick-reply buttons take priority.
  if (button === 'CONFIRM' || button === 'CANCEL') {
    return handleCodButton(from, button, profileName);
  }

  // 2) If a human is already handling this chat, stay out of the way — and
  // slide the 24h auto-release window forward since the customer is active.
  if (await isEscalated(from)) {
    await touchHandover(from);
    await logSystem({ event: 'inbound_while_escalated', from });
    return;
  }

  // 3) Native interactive replies — routed by reply id, not by matching text.
  if (interactiveId) {
    const routed = await routeInteractive(from, interactiveId, message);
    if (routed.handled) return;
    if (routed.aiText) return handleAiChat(from, routed.aiText);
  }

  // 4) Nothing textual to answer (media, reaction, etc.).
  if (!text) {
    await sendText(
      from,
      `Thanks ${profileName}! 🙏 Could you type your question so I can help? You can also visit our Sector 45, Gurugram showroom (${S.hours}) or email ${S.email}.`
    );
    return;
  }

  // 5) Explicit request for a person -> handover immediately.
  if (HUMAN_REQUEST_RE.test(text)) {
    return escalate(from, 'explicit_human_request', { profileName, triggerText: text });
  }

  // 5b) Asking for a number to call -> handover immediately.
  if (NUMBER_REQUEST_RE.test(text)) {
    return escalate(from, 'number_request', { profileName, triggerText: text });
  }

  // 5c) Bulk/wholesale/complaint/payment-issue safety net -> handover.
  if (BUSINESS_ESCALATION_RE.test(text)) {
    return escalate(from, 'business_escalation', { profileName, triggerText: text });
  }

  // 6) Ad-sourced first-touch: tag so we open with a qualifying question.
  if (isAdStarter(text)) await setAdSourced(from);

  // 7) AI chat.
  return handleAiChat(from, text);
}

// ── Interactive reply routing (by id) ────────────────────────────────

async function routeInteractive(from, id, message) {
  // Booking slot picked from the time-slot list.
  if (id.startsWith('slot:')) {
    const slot = id.slice('slot:'.length);
    await sendText(from, `Booked! ✅ ${slot} — GemHub showroom, Sector 45, Gurugram. See you soon. 💎`);
    await sendLocation(from, {
      latitude: S.latitude,
      longitude: S.longitude,
      name: S.name,
      address: S.address,
    });
    await sendCtaUrl(from, `We're open ${S.hours}. Tap for directions:`, 'Get Directions', S.mapsUrl);
    await appendTurns(from, [
      { role: 'user', content: `[Booked a showroom visit: ${slot}]` },
      { role: 'assistant', content: `[Confirmed visit for ${slot} and shared the showroom location]` },
    ]);
    await logSystem({ event: 'visit_booked', from, slot });
    return { handled: true };
  }

  // A piece picked from a product shortlist.
  if (id.startsWith('product:')) {
    const pid = id.slice('product:'.length);
    const shortlist = await getLastProducts(from);
    const piece = shortlist.find((p) => p.id === pid);
    if (piece) {
      await sendProductCards(from, [piece]);
      await sendButtons(from, 'Love it? I can hold it for a viewing or share more like it.', AFTER_PRODUCTS_MENU);
      await appendTurns(from, [
        { role: 'user', content: `[Selected piece: ${piece.title}]` },
        { role: 'assistant', content: `[Showed ${piece.title} with a View Product link]` },
      ]);
      return { handled: true };
    }
    return { aiText: '[The customer selected a piece from the shortlist. Show it again with details and offer to book a viewing.]' };
  }

  // Menu buttons.
  if (id === 'talk_to_expert') {
    await escalate(from, 'talk_to_expert');
    return { handled: true };
  }
  if (id === 'get_directions') {
    await sendText(from, `Here's our showroom — we'd love to see you. 💎`);
    await sendLocation(from, {
      latitude: S.latitude,
      longitude: S.longitude,
      name: S.name,
      address: S.address,
    });
    await sendCtaUrl(from, `Open ${S.hours}. Tap for directions:`, 'Get Directions', S.mapsUrl);
    return { handled: true };
  }
  if (id === 'book_visit' || id === 'book_a_visit') {
    await sendBooking(from, 'Wonderful — pick a time that suits you and I’ll note it down. 💎');
    return { handled: true };
  }
  if (MENU_INTENT[id]) return { aiText: MENU_INTENT[id] };

  // Unknown id — hand the tapped title to the AI.
  const title =
    message?.interactive?.button_reply?.title || message?.interactive?.list_reply?.title || id;
  return { aiText: `[Customer tapped: ${title}]` };
}

// ── COD confirm / cancel ─────────────────────────────────────────────

async function handleCodButton(from, decision, profileName) {
  const pending = await getCodPending(from);
  if (!pending) {
    await sendText(
      from,
      `Thanks ${profileName}! I couldn’t find a pending order to update — it may already be confirmed. For help, reply here or email ${S.email}.`
    );
    return;
  }

  try {
    if (decision === 'CONFIRM') {
      await addOrderTags(pending.orderId, ['cod-confirmed']);
      await clearCodPending(from);
      await sendText(
        from,
        `Thank you! ✅ Your COD order ${pending.orderName} is confirmed. We’re packing it now and you’ll get a tracking link once it ships. 💎`
      );
      await logSystem({ event: 'cod_confirmed', order: pending.orderName, from });
    } else {
      await addOrderTags(pending.orderId, ['cod-cancelled']);
      await cancelOrder(pending.orderId, { reason: 'customer' });
      await clearCodPending(from);
      await sendText(
        from,
        `Your COD order ${pending.orderName} has been cancelled. No charge applies. If this was a mistake or you’d like help ordering again, just reply here. 🙏`
      );
      await logSystem({ event: 'cod_cancelled', order: pending.orderName, from });
    }
  } catch (err) {
    await logSystem({ event: 'cod_button_error', from, decision, error: err.message });
    await sendText(
      from,
      `Sorry, something went wrong updating your order. Our team will sort it out — please email ${S.email} and we’ll fix it right away. 🙏`
    );
  }
}

// ── AI chat ──────────────────────────────────────────────────────────

async function handleAiChat(from, text) {
  let reply;
  try {
    const adSourced = await isAdSourced(from);
    const history = await loadHistory(from);
    reply = await generateReply({ history, userText: text, adSourced });
  } catch (err) {
    await logSystem({ event: 'ai_error', from, error: err.message });
    await sendText(
      from,
      `Sorry, I’m having a moment 🙏 Please try again, or reach us at ${S.email} / our Sector 45, Gurugram showroom (${S.hours}).`
    );
    return;
  }

  // Escalation with nothing to render -> hand off.
  if (reply.wantsHuman && reply.actions.length === 0) {
    await escalate(from, reply.reason || 'human_requested', { triggerText: text });
    await appendTurns(from, [
      { role: 'user', content: text },
      { role: 'assistant', content: `[Handed off to ${AGENT.name}, GemHub sales specialist]` },
    ]);
    return;
  }

  const summary = await renderActions(from, reply.actions);

  await appendTurns(from, [
    { role: 'user', content: text },
    { role: 'assistant', content: summary || '[sent options]' },
  ]);

  // Escalation logic (soft failures accumulate).
  if (reply.unableCount > 0) {
    const fails = await bumpIntentFailures(from, reply.unableCount);
    if (fails >= ESCALATION_THRESHOLD) {
      await escalate(from, `failed_intents:${fails}`, { triggerText: text });
    }
  } else {
    await resetIntentFailures(from);
  }
}

// ── Render actions from the consultant ───────────────────────────────

async function renderActions(from, actions) {
  const bodies = [];
  for (const action of actions || []) {
    if (action.body) bodies.push(action.body);
    switch (action.kind) {
      case 'text':
        await sendText(from, action.body);
        break;
      case 'menu':
        await sendButtons(from, action.body, DEFAULT_MENU);
        break;
      case 'after_products':
        await sendButtons(from, action.body, AFTER_PRODUCTS_MENU);
        break;
      case 'location':
        if (action.body) await sendText(from, action.body);
        await sendLocation(from, {
          latitude: S.latitude,
          longitude: S.longitude,
          name: S.name,
          address: S.address,
        });
        await sendCtaUrl(from, `We're open ${S.hours}. Tap for directions:`, 'Get Directions', S.mapsUrl);
        break;
      case 'booking':
        await sendBooking(from, action.body);
        break;
      case 'products':
        await sendProductCards(from, action.products, { body: action.body });
        await setLastProducts(from, action.products);
        break;
      default:
        if (action.body) await sendText(from, action.body);
    }
  }
  return bodies.join('\n').trim();
}

async function sendBooking(from, body) {
  await sendList(
    from,
    body || 'Pick a time that suits you:',
    'Pick a time',
    [
      {
        title: 'Today & this week',
        rows: SLOTS.map((s) => ({
          id: `slot:${s}`,
          title: s,
          description: 'Showroom visit, Sector 45 Gurugram',
        })),
      },
    ],
    { header: 'Book your visit', footer: `Open ${S.hours}` }
  );
}

// ── Escalation / human handover ──────────────────────────────────────
// Thin wrapper: the real work (language-aware customer message, notifying
// the sales agent, and the Redis handover flag) lives in lib/handover.js.

async function escalate(from, reason, { profileName, triggerText } = {}) {
  await triggerHandover(from, { reason, profileName, triggerText });
}

// ── WhatsApp payload extraction ──────────────────────────────────────

function extractText(message) {
  if (message?.type === 'text') return (message.text?.body || '').trim();
  if (message?.type === 'interactive') {
    const it = message.interactive;
    if (it?.type === 'list_reply') return (it.list_reply?.title || '').trim();
    if (it?.type === 'button_reply') return (it.button_reply?.title || '').trim();
  }
  if (message?.type === 'button') return (message.button?.text || '').trim();
  return '';
}

/** Native interactive reply id (button_reply.id or list_reply.id), or null. */
function extractInteractiveId(message) {
  if (message?.type !== 'interactive') return null;
  const it = message.interactive;
  if (it?.type === 'button_reply') return it.button_reply?.id || null;
  if (it?.type === 'list_reply') return it.list_reply?.id || null;
  return null;
}

/**
 * Returns 'CONFIRM' | 'CANCEL' | null. Template quick-reply buttons arrive as
 * type 'button' with a payload; native interactive replies as button_reply.id.
 */
function extractButtonPayload(message) {
  let raw = null;
  if (message?.type === 'button') {
    raw = message.button?.payload || message.button?.text;
  } else if (message?.type === 'interactive' && message.interactive?.type === 'button_reply') {
    raw = message.interactive.button_reply?.id || message.interactive.button_reply?.title;
  }
  if (!raw) return null;
  const up = String(raw).trim().toUpperCase();
  if (up.includes('CONFIRM')) return 'CONFIRM';
  if (up.includes('CANCEL')) return 'CANCEL';
  return null;
}

function isAdStarter(text) {
  const t = (text || '').toLowerCase();
  return /gemhub/.test(t) && /lab-?grown diamond/.test(t);
}
