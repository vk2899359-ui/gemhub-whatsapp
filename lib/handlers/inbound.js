// Processes a single inbound WhatsApp message: de-dup, button routing
// (COD CONFIRM/CANCEL), AI chat, and human escalation.
import { sendText, markRead } from '../whatsapp.js';
import { logIncoming, logSystem } from '../log.js';
import {
  claimMessage,
  touchWindow,
  loadHistory,
  appendTurns,
  isEscalated,
  setEscalated,
  bumpIntentFailures,
  resetIntentFailures,
} from '../state.js';
import { getCodPending, clearCodPending } from '../stores.js';
import { addOrderTags, cancelOrder } from '../shopify.js';
import { generateReply } from '../claude.js';

const HUMAN_REQUEST_RE =
  /\b(human|agent|representative|person|customer care|customer support|talk to (someone|a person)|call me|phone call|manager)\b|इंसान|व्यक्ति|एजेंट|बात कर(ना|ें)|फ़?ोन|call karo|baat kar|insaan/i;

const ESCALATION_THRESHOLD = 3;

/**
 * @param {object} message a single WhatsApp `messages[]` entry
 * @param {object} contact the matching `contacts[0]` entry (may be undefined)
 */
export async function handleInboundMessage(message, contact) {
  const messageId = message?.id;
  const from = message?.from;
  if (!from) return;

  // Exactly-once processing (WhatsApp retries webhooks).
  const fresh = await claimMessage(messageId);
  if (!fresh) {
    await logSystem({ event: 'duplicate_ignored', messageId });
    return;
  }

  const profileName = contact?.profile?.name || 'there';
  await touchWindow(from);
  markRead(messageId); // best-effort, fire-and-forget

  const button = extractButtonPayload(message);
  const text = extractText(message);

  await logIncoming({
    from,
    messageId,
    type: message?.type,
    button,
    text,
    profileName,
  });

  // 1) COD quick-reply buttons take priority.
  if (button === 'CONFIRM' || button === 'CANCEL') {
    return handleCodButton(from, button, profileName);
  }

  // 2) If a human is already handling this chat, stay out of the way.
  if (await isEscalated(from)) {
    await logSystem({ event: 'inbound_while_escalated', from });
    return;
  }

  // Nothing textual to answer (media, location, reaction, etc.).
  if (!text) {
    await sendText(
      from,
      `Thanks ${profileName}! 🙏 Could you type your question so I can help? You can also visit our Sector 45, Gurugram showroom (10 AM–7 PM) or email care@gemhub.in.`
    );
    return;
  }

  // 3) Explicit request for a person -> escalate immediately.
  if (HUMAN_REQUEST_RE.test(text)) {
    await escalate(from, 'explicit_human_request');
    return;
  }

  // 4) AI chat.
  return handleAiChat(from, text);
}

// ── COD confirm / cancel ─────────────────────────────────────────────

async function handleCodButton(from, decision, profileName) {
  const pending = await getCodPending(from);
  if (!pending) {
    await sendText(
      from,
      `Thanks ${profileName}! I couldn’t find a pending order to update — it may already be confirmed. For help, reply here or email care@gemhub.in.`
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
      await logSystem({
        event: 'cod_confirmed',
        order: pending.orderName,
        from,
      });
    } else {
      // CANCEL
      await addOrderTags(pending.orderId, ['cod-cancelled']);
      await cancelOrder(pending.orderId, { reason: 'customer' });
      await clearCodPending(from);
      await sendText(
        from,
        `Your COD order ${pending.orderName} has been cancelled. No charge applies. If this was a mistake or you’d like help ordering again, just reply here. 🙏`
      );
      await logSystem({
        event: 'cod_cancelled',
        order: pending.orderName,
        from,
      });
    }
  } catch (err) {
    await logSystem({
      event: 'cod_button_error',
      from,
      decision,
      error: err.message,
    });
    await sendText(
      from,
      `Sorry, something went wrong updating your order. Our team will sort it out — please email care@gemhub.in and we’ll fix it right away. 🙏`
    );
  }
}

// ── AI chat ──────────────────────────────────────────────────────────

async function handleAiChat(from, text) {
  let reply;
  try {
    const history = await loadHistory(from);
    reply = await generateReply({ history, userText: text });
  } catch (err) {
    await logSystem({ event: 'ai_error', from, error: err.message });
    await sendText(
      from,
      `Sorry, I’m having a moment 🙏 Please try again, or reach us at care@gemhub.in / our Sector 45, Gurugram showroom (10 AM–7 PM).`
    );
    return;
  }

  await sendText(from, reply.text);

  // Persist the exchange for context (last 10 turns, 24h TTL).
  await appendTurns(from, [
    { role: 'user', content: text },
    { role: 'assistant', content: reply.text },
  ]);

  // Escalation logic.
  if (reply.wantsHuman) {
    await escalate(from, reply.reason || 'human_requested', { alreadyReplied: true });
    return;
  }

  if (reply.unableCount > 0) {
    const fails = await bumpIntentFailures(from, reply.unableCount);
    if (fails >= ESCALATION_THRESHOLD) {
      await escalate(from, `failed_intents:${fails}`, { alreadyReplied: true });
    }
  } else {
    // A successful, resolved turn clears the failure streak.
    await resetIntentFailures(from);
  }
}

// ── Escalation ───────────────────────────────────────────────────────

async function escalate(from, reason, { alreadyReplied = false } = {}) {
  await setEscalated(from, reason);
  await logSystem({ event: 'escalated', from, reason });
  if (!alreadyReplied) {
    await sendText(
      from,
      `Of course — I’m connecting you with a GemHub specialist who’ll reply here shortly. 🙏 You can also reach us at care@gemhub.in or visit our showroom: 2nd Floor, Unit 201, Greenwood Plaza, Sector 45, Gurugram (10 AM–7 PM).`
    );
  }
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

/**
 * Returns 'CONFIRM' | 'CANCEL' | null.
 * Template quick-reply buttons arrive as type 'button' with a payload; native
 * interactive replies arrive as type 'interactive' -> button_reply.id.
 */
function extractButtonPayload(message) {
  let raw = null;
  if (message?.type === 'button') {
    raw = message.button?.payload || message.button?.text;
  } else if (
    message?.type === 'interactive' &&
    message.interactive?.type === 'button_reply'
  ) {
    raw = message.interactive.button_reply?.id || message.interactive.button_reply?.title;
  }
  if (!raw) return null;
  const up = String(raw).trim().toUpperCase();
  if (up.includes('CONFIRM')) return 'CONFIRM';
  if (up.includes('CANCEL')) return 'CANCEL';
  return null;
}
