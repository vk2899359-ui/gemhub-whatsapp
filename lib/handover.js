// Human handover: hands a conversation off to the GemHub sales agent
// (Keshav). On trigger this does all three required things:
//   1. Tells the customer, in their language, that Keshav will help and
//      shares his number so they can call directly.
//   2. Messages Keshav on WhatsApp with a lead summary (free-form if his 24h
//      window is open, an approved template otherwise).
//   3. Sets a Redis handover flag so the bot stays quiet for that customer,
//      with a sliding 24h auto-release plus an explicit release command/
//      reply-to-release for the agent.
import { CONFIG } from './env.js';
import { normalizePhone } from './phone.js';
import { detectLanguage } from './lang.js';
import { extractBudgetMention } from './leadinfo.js';
import { sendText, sendTemplate } from './whatsapp.js';
import { leadHandover } from './templates.js';
import { logSystem } from './log.js';
import {
  isWithinWindow,
  loadHistory,
  getLastProducts,
  setProfileName,
  getProfileName,
  setEscalated,
  clearEscalation,
  isEscalated,
  getEscalationRecord,
  addActiveHandover,
  removeActiveHandover,
  listActiveHandovers,
  setLeadMessageCustomer,
  getLeadMessageCustomer,
} from './state.js';

export const AGENT = {
  name: CONFIG.SALES_AGENT.name,
  phone: normalizePhone(CONFIG.SALES_AGENT.phone),
  displayPhone: CONFIG.SALES_AGENT.phone,
};

export function isFromAgent(fromPhone) {
  return Boolean(AGENT.phone) && fromPhone === AGENT.phone;
}

// ── Customer-facing handover message (language-aware, no AI call) ─────

function customerHandoverMessage(lang) {
  const address = CONFIG.SHOWROOM.address;
  const hours = CONFIG.SHOWROOM.hours;
  if (lang === 'hi') {
    return (
      `बिल्कुल! मैं आपको हमारी GemHub सेल्स टीम के ${AGENT.name} से जोड़ रहा/रही हूँ — वे आपकी पूरी मदद करेंगे। 🙏\n` +
      `📞 सीधे कॉल करें: ${AGENT.displayPhone}\n` +
      `📍 या हमसे मिलें: ${address} (${hours})`
    );
  }
  if (lang === 'hinglish') {
    return (
      `Bilkul! Main aapko hamari GemHub sales team ke ${AGENT.name} se connect kar raha hoon — wo aapki poori help karenge. 🙏\n` +
      `📞 Seedhe call karein: ${AGENT.displayPhone}\n` +
      `📍 Ya humse milein: ${address} (${hours})`
    );
  }
  return (
    `Of course! I'm connecting you with ${AGENT.name} from our GemHub sales team — he'll take great care of you. 🙏\n` +
    `📞 Call him directly: ${AGENT.displayPhone}\n` +
    `📍 Or visit us: ${address} (${hours})`
  );
}

// ── Lead summary composition ───────────────────────────────────────────

function turnText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === 'string' ? c : c?.text || ''))
      .filter(Boolean)
      .join(' ');
  }
  return '';
}

function clip(str, n) {
  const s = String(str || '');
  return s.length > n ? s.slice(0, n - 1).trim() + '…' : s;
}

/**
 * Builds everything needed for both the free-form and template paths.
 */
async function composeLeadInfo(customerPhone, { reason, profileName, triggerText, history }) {
  const products = await getLastProducts(customerPhone);

  const historyText = history.map((h) => turnText(h.content)).join('\n');
  const budget = extractBudgetMention(`${historyText} ${triggerText || ''}`);

  // "What they were asking about" — last non-empty user message, or the
  // trigger text itself.
  const lastUserTurn = [...history].reverse().find((h) => h.role === 'user');
  const topic = clip(turnText(lastUserTurn?.content) || triggerText || 'General enquiry', 90);

  const productLines = (products || [])
    .slice(0, 4)
    .map((p) => `${p.title}${p.price ? ` (${p.price})` : ''}`);

  const reasonLabel = describeReason(reason);

  // Short transcript: last 3 turns (6 messages), trimmed.
  const recent = history.slice(-6);
  const transcriptLines = recent.map((h) => {
    const who = h.role === 'user' ? 'Customer' : 'GemHub';
    return `${who}: ${clip(turnText(h.content), 160)}`;
  });

  return {
    name: profileName || 'there',
    phone: customerPhone,
    topic,
    products: productLines,
    budget,
    reasonLabel,
    transcriptLines,
  };
}

function describeReason(reason) {
  const map = {
    explicit_human_request: 'Asked to speak with a person',
    number_request: 'Asked for a contact number',
    business_escalation: "Needs help beyond the bot's scope",
    talk_to_expert: "Tapped 'Talk to Expert'",
  };
  if (map[reason]) return map[reason];
  if (reason?.startsWith('failed_intents:')) return "Bot couldn't resolve the query (3 attempts)";
  return reason || 'Handed off to a specialist';
}

function freeFormLeadText(info) {
  const lines = [
    `🔔 *New GemHub lead*`,
    ``,
    `*Customer:* ${info.name}`,
    `*WhatsApp:* ${info.phone}`,
    `*Reason:* ${info.reasonLabel}`,
    `*Asking about:* ${info.topic}`,
  ];
  if (info.budget) lines.push(`*Budget mentioned:* ${info.budget}`);
  if (info.products.length) lines.push(`*Shown:* ${info.products.join(', ')}`);
  if (info.transcriptLines.length) {
    lines.push('', '*Recent chat:*', ...info.transcriptLines);
  }
  lines.push('', 'Reply here to claim this chat — the bot will stay quiet for this customer while you handle it.');
  return lines.join('\n');
}

// ── Notify the agent (free-form if his window is open, else template) ──

async function notifyAgent(info) {
  if (!AGENT.phone) {
    await logSystem({ event: 'handover_no_agent_configured' });
    return null;
  }

  try {
    const open = await isWithinWindow(AGENT.phone);
    if (open) {
      const { messageId } = await sendText(AGENT.phone, freeFormLeadText(info));
      return messageId;
    }
    const { messageId } = await sendTemplate(
      AGENT.phone,
      leadHandover({
        customerName: clip(info.name, 40),
        customerPhone: info.phone,
        interest: clip(info.topic, 60),
        reason: clip(info.reasonLabel, 60),
      })
    );
    return messageId;
  } catch (err) {
    await logSystem({ event: 'handover_notify_agent_failed', error: err.message, customer: info.phone });
    return null;
  }
}

// ── Main entry: trigger a handover for a customer ──────────────────────

/**
 * @param {string} customerPhone
 * @param {{reason:string, profileName?:string, triggerText?:string}} opts
 */
export async function triggerHandover(customerPhone, { reason, profileName, triggerText } = {}) {
  // Don't double-fire (and don't spam Keshav again) if already handed over.
  if (await isEscalated(customerPhone)) {
    await logSystem({ event: 'handover_already_active', customer: customerPhone, reason });
    return;
  }

  if (profileName && profileName !== 'there') await setProfileName(customerPhone, profileName);
  const resolvedName = profileName && profileName !== 'there' ? profileName : await getProfileName(customerPhone);

  const history = await loadHistory(customerPhone);
  // Fall back to the customer's last message (e.g. a button-tap handover has
  // no triggerText of its own) so language detection isn't blind.
  const lastUserText = triggerText || turnText([...history].reverse().find((h) => h.role === 'user')?.content);

  const lang = detectLanguage(lastUserText);
  await sendText(customerPhone, customerHandoverMessage(lang));

  const info = await composeLeadInfo(customerPhone, { reason, profileName: resolvedName, triggerText, history });
  const leadMessageId = await notifyAgent(info);

  await setEscalated(customerPhone, {
    reason,
    profileName: resolvedName || null,
    leadMessageId: leadMessageId || null,
  });
  await addActiveHandover(customerPhone);
  if (leadMessageId) await setLeadMessageCustomer(leadMessageId, customerPhone);

  await logSystem({ event: 'handover_triggered', customer: customerPhone, reason, leadMessageId });
}

// ── Agent-side inbound handling (release commands) ─────────────────────

function extractReplyContextId(message) {
  return message?.context?.id || null;
}

function parseReleaseCommand(text) {
  const t = String(text || '').trim();
  const mAll = /^release\s+all$/i.exec(t);
  if (mAll) return { all: true };
  const mNum = /^release\s+(\+?[\d\s-]{6,})$/i.exec(t);
  if (mNum) return { phone: normalizePhone(mNum[1]) };
  if (/^(done|resolved|ok|closed)$/i.test(t)) return { bare: true };
  return null;
}

async function releaseOne(phone) {
  await clearEscalation(phone);
  await removeActiveHandover(phone);
  await logSystem({ event: 'handover_released', customer: phone });
}

/**
 * Handle a message FROM the sales agent. Never runs customer/AI logic.
 */
export async function handleAgentInbound(message) {
  const text = message?.type === 'text' ? (message.text?.body || '').trim() : '';
  const replyToId = extractReplyContextId(message);

  await logSystem({ event: 'agent_inbound', text, replyToId });

  // 1) Reply-to-release: swipe-reply on the lead message is unambiguous.
  if (replyToId) {
    const phone = await getLeadMessageCustomer(replyToId);
    if (phone && (await isEscalated(phone))) {
      await releaseOne(phone);
      await sendText(AGENT.phone, `✅ Released ${phone} — bot is back on for that chat.`);
      return;
    }
  }

  const cmd = parseReleaseCommand(text);
  if (cmd?.all) {
    const active = await listActiveHandovers();
    let released = 0;
    for (const phone of active) {
      if (await isEscalated(phone)) {
        await releaseOne(phone);
        released++;
      } else {
        await removeActiveHandover(phone); // self-heal stale entries
      }
    }
    await sendText(AGENT.phone, `✅ Released ${released} chat(s). Bot is back on.`);
    return;
  }

  if (cmd?.phone) {
    if (await isEscalated(cmd.phone)) {
      await releaseOne(cmd.phone);
      await sendText(AGENT.phone, `✅ Released ${cmd.phone} — bot is back on for that chat.`);
    } else {
      await sendText(AGENT.phone, `That number isn't currently handed over to you.`);
    }
    return;
  }

  if (cmd?.bare) {
    const active = await listActiveHandovers();
    const stillActive = [];
    for (const phone of active) {
      if (await isEscalated(phone)) stillActive.push(phone);
    }
    if (stillActive.length === 1) {
      await releaseOne(stillActive[0]);
      await sendText(AGENT.phone, `✅ Released ${stillActive[0]} — bot is back on for that chat.`);
    } else if (stillActive.length === 0) {
      await sendText(AGENT.phone, `No active handovers right now.`);
    } else {
      await sendText(
        AGENT.phone,
        `You have ${stillActive.length} active chats: ${stillActive.join(', ')}.\nReply to the specific lead message, or send "release <number>" / "release all".`
      );
    }
    return;
  }

  // Unrecognised message from the agent — remind him how release works,
  // but only if he has at least one active handover (avoid noise otherwise).
  const active = await listActiveHandovers();
  if (active.length > 0) {
    await sendText(
      AGENT.phone,
      `To release a chat back to the bot: reply directly to that lead message, or send "release <number>" / "release all".`
    );
  }
}
