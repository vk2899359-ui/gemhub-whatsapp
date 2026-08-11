// The bulk-campaign sending engine. A single "tick" (processTick) handles a
// bounded chunk of work and is safe to call repeatedly — from itself
// (self-chaining, the primary driver on Vercel Hobby where there's no
// always-on worker), from the dashboard while a campaign is open, or from
// the daily cron's stalled-campaign sweep. Every guardrail from the spec is
// enforced here, in one place, so nothing can send without going through it.
import { waitUntil } from '@vercel/functions';
import { CONFIG } from './env.js';
import { clean } from './templates.js';
import { sendTemplate, sendText } from './whatsapp.js';
import { getQualityRating } from './meta.js';
import { normalizePhone } from './phone.js';
import { logSystem } from './log.js';
import {
  STATUSES,
  getCampaign,
  updateCampaign,
  incrementCounter,
  setRunning,
  listRunningCampaignIds,
  getQueueSlice,
  getQueueLength,
  getRecipientStatus,
  setRecipientStatus,
  setCursor,
  pushRetry,
  popRetry,
  pushRetryBack,
  getRetryQueueLength,
  isSuppressed,
  isInCooldown,
  markCooldown,
  isKillSwitchOn,
  getSentToday,
  incrementSentToday,
  getCachedQuality,
  setCachedQuality,
  mapCampaignMessage,
  markLastCampaignSent,
} from './campaigns.js';

const MAX_ATTEMPTS = 3;
const PRIMARY_SCAN_WINDOW = 300; // recipients inspected per tick (most are already-terminal skips, cheap)
const RETRY_SCAN_WINDOW = 50;
const SELF_CHAIN_DELAY_IDLE_MS = 5000; // avoid a tight busy-loop when nothing was ready to send

// ── Variable resolution ─────────────────────────────────────────────

function resolveVar(mapping, lead) {
  if (!mapping) return '';
  if (mapping.source === 'static') return mapping.value || '';
  if (mapping.source === 'name') return lead.name || '';
  if (mapping.source === 'phone') return lead.phone || '';
  if (mapping.source === 'column') return lead.extra?.[mapping.value] ?? '';
  return '';
}

function bodyVarCount(templateComponents) {
  const body = (templateComponents || []).find((c) => c.type === 'BODY');
  return ((body?.text || '').match(/\{\{\d+\}\}/g) || []).length;
}

function hasImageHeader(templateComponents) {
  const header = (templateComponents || []).find((c) => c.type === 'HEADER');
  return header?.format === 'IMAGE';
}

/**
 * Plain-text version of what this lead was actually sent (template body with
 * {{n}} replaced by the resolved values) — stored on the recipient record so
 * that if/when they reply, the AI consultant can stay on-topic about the
 * specific piece/price they were offered instead of opening generically.
 */
function buildResolvedOfferText(campaign, lead) {
  const body = (campaign.templateComponents || []).find((c) => c.type === 'BODY');
  let text = body?.text || '';
  const n = bodyVarCount(campaign.templateComponents);
  for (let i = 1; i <= n; i++) {
    text = text.split(`{{${i}}}`).join(clean(resolveVar(campaign.variableMapping[String(i)], lead)));
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, 500);
}

/** Build the WhatsApp send `components` array for one recipient. */
export function buildSendComponents(campaign, lead) {
  const components = [];
  if (campaign.imageMediaId && hasImageHeader(campaign.templateComponents)) {
    components.push({ type: 'header', parameters: [{ type: 'image', image: { id: campaign.imageMediaId } }] });
  }
  const n = bodyVarCount(campaign.templateComponents);
  if (n > 0) {
    const params = [];
    for (let i = 1; i <= n; i++) {
      params.push({ type: 'text', text: clean(resolveVar(campaign.variableMapping[String(i)], lead)) });
    }
    components.push({ type: 'body', parameters: params });
  }
  return components;
}

// ── Error classification ────────────────────────────────────────────

// 131056 = "too many messages sent to this recipient in a short period"
// (WhatsApp's per-recipient spam-rate throttle). 130429/4 = app-level rate
// limiting. Both plus generic 429/5xx are treated as transient/retryable and
// also trip a same-tick cool-down so we don't hammer straight into the same
// wall on the very next send.
const RATE_LIMIT_SUBCODES = new Set([131056]);
const RATE_LIMIT_CODES = new Set([4, 80007, 130429]);

function classifyError(err) {
  const status = err.httpStatus;
  const code = err.metaCode;
  const subcode = err.metaSubcode;
  const isRateLimit =
    status === 429 || RATE_LIMIT_CODES.has(code) || RATE_LIMIT_SUBCODES.has(subcode);
  const isTransient = isRateLimit || (status >= 500 && status <= 599);
  return { isRateLimit, isTransient };
}

function backoffMs(attempts) {
  return Math.min(30 * 60 * 1000, 2000 * 2 ** attempts); // 2s,4s,8s... capped at 30min
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Alerts (reuses the existing send layer, no new plumbing) ──────────

async function alertOwner(message) {
  try {
    const phone = normalizePhone(CONFIG.CAMPAIGNS.ALERT_PHONE);
    if (phone) await sendText(phone, `⚠️ GemHub campaigns: ${message}`);
  } catch (err) {
    console.error('[campaign-sender] alertOwner failed', err.message);
  }
  await logSystem({ event: 'campaign_alert', message });
}

// ── Quality-rating guardrail ─────────────────────────────────────────

async function checkQualityGuardrail() {
  let rating = await getCachedQuality();
  if (!rating) {
    try {
      rating = await getQualityRating();
      await setCachedQuality(rating);
    } catch (err) {
      // Can't verify quality -> fail safe by NOT blocking (transient API
      // hiccup shouldn't halt every campaign), but log loudly.
      await logSystem({ event: 'quality_check_failed', error: err.message });
      return { action: 'continue', rating: 'UNKNOWN' };
    }
  }

  if (rating === 'RED') {
    const running = await listRunningCampaignIds();
    for (const id of running) {
      await updateCampaign(id, { status: STATUSES.STOPPED_QUALITY });
      await setRunning(id, false);
    }
    if (running.length) {
      await alertOwner(`Quality rating dropped to RED. Stopped ${running.length} running campaign(s) immediately.`);
    }
    return { action: 'stop', rating };
  }

  if (rating === 'YELLOW') {
    const running = await listRunningCampaignIds();
    for (const id of running) {
      await updateCampaign(id, { status: STATUSES.PAUSED_QUALITY });
    }
    if (running.length) {
      await alertOwner(`Quality rating dropped to YELLOW. Paused ${running.length} running campaign(s) — resume manually once it recovers.`);
    }
    return { action: 'pause', rating };
  }

  return { action: 'continue', rating };
}

// ── Per-recipient send ───────────────────────────────────────────────

async function attemptSend(campaign, phone, attemptsSoFar) {
  const recipient = await getRecipientStatus(campaign.id, phone);
  if (!recipient) return { outcome: 'missing' };
  if (recipient.status === 'sent' || recipient.status === 'failed' || recipient.status.startsWith('skipped_')) {
    return { outcome: 'already_terminal' };
  }

  if (await isSuppressed(phone)) {
    await setRecipientStatus(campaign.id, phone, { status: 'skipped_suppressed' });
    await incrementCounter(campaign.id, 'skipped');
    return { outcome: 'skipped' };
  }
  if (await isInCooldown(phone)) {
    await setRecipientStatus(campaign.id, phone, { status: 'skipped_cooldown' });
    await incrementCounter(campaign.id, 'skipped');
    return { outcome: 'skipped' };
  }
  if (!normalizePhone(phone)) {
    await setRecipientStatus(campaign.id, phone, { status: 'skipped_invalid' });
    await incrementCounter(campaign.id, 'skipped');
    return { outcome: 'skipped' };
  }

  const components = buildSendComponents(campaign, recipient);
  try {
    const { messageId } = await sendTemplate(phone, {
      name: campaign.templateName,
      language: campaign.templateLanguage,
      components,
    });
    await setRecipientStatus(campaign.id, phone, {
      status: 'sent',
      sentAt: Date.now(),
      attempts: attemptsSoFar + 1,
      offerText: buildResolvedOfferText(campaign, recipient),
    });
    await incrementCounter(campaign.id, 'sent');
    await incrementSentToday();
    await markCooldown(phone, campaign.cooldownDays);
    await markLastCampaignSent(phone, campaign.id);
    if (messageId) await mapCampaignMessage(messageId, campaign.id, phone);
    return { outcome: 'sent' };
  } catch (err) {
    const { isRateLimit, isTransient } = classifyError(err);
    const attempts = attemptsSoFar + 1;
    if (isTransient && attempts < MAX_ATTEMPTS) {
      await setRecipientStatus(campaign.id, phone, {
        status: 'retry_pending',
        attempts,
        nextAttemptAt: Date.now() + backoffMs(attempts),
        lastError: err.message,
      });
      await pushRetry(campaign.id, phone);
      return { outcome: 'retry_scheduled', isRateLimit };
    }
    await setRecipientStatus(campaign.id, phone, { status: 'failed', attempts, lastError: err.message });
    await incrementCounter(campaign.id, 'failed');
    return { outcome: 'failed', isRateLimit };
  }
}

// ── One campaign's slice of a tick ──────────────────────────────────

async function processCampaignTick(campaign, deadline) {
  const throttleGapMs = campaign.throttlePerSec > 0 ? 1000 / campaign.throttlePerSec : 0;
  let sentThisTick = 0;
  let rateLimited = false;

  let dailyBudget = CONFIG.CAMPAIGNS.DAILY_CAP - (await getSentToday());

  // 1) Retry queue first (bounded) — these are recipients already waiting.
  let retryChecked = 0;
  const retryRequeue = [];
  while (retryChecked < RETRY_SCAN_WINDOW && dailyBudget > 0 && Date.now() < deadline && !rateLimited) {
    const phone = await popRetry(campaign.id);
    if (!phone) break;
    retryChecked++;
    const status = await getRecipientStatus(campaign.id, phone);
    if (!status || status.status !== 'retry_pending') continue; // resolved elsewhere already
    if (status.nextAttemptAt > Date.now()) {
      retryRequeue.push(phone); // not ready yet, put back after this pass
      continue;
    }
    const result = await attemptSend(campaign, phone, status.attempts);
    if (result.outcome === 'sent' || result.outcome === 'failed') {
      sentThisTick++;
      dailyBudget--;
    }
    if (result.isRateLimit) rateLimited = true;
    if (throttleGapMs) await sleep(throttleGapMs);
  }
  for (const phone of retryRequeue) await pushRetryBack(campaign.id, phone);

  // 2) Primary queue — first-attempt sends, monotonic cursor.
  let cursor = campaign.cursor;
  const total = campaign.totalRecipients;
  let scanned = 0;
  if (!rateLimited) {
    const slice = await getQueueSlice(campaign.id, cursor, Math.min(cursor + PRIMARY_SCAN_WINDOW, total) - 1);
    for (const phone of slice) {
      scanned++;
      if (dailyBudget <= 0 || Date.now() >= deadline || rateLimited) break;
      const status = await getRecipientStatus(campaign.id, phone);
      if (status && status.status !== 'pending') {
        cursor++;
        continue; // already handled in a prior tick (resumability guard)
      }
      const result = await attemptSend(campaign, phone, 0);
      cursor++;
      if (result.outcome === 'sent' || result.outcome === 'failed' || result.outcome === 'skipped') {
        sentThisTick++;
        dailyBudget--;
      }
      if (result.isRateLimit) rateLimited = true;
      if (throttleGapMs) await sleep(throttleGapMs);
    }
    await setCursor(campaign.id, cursor);
  }

  const retryLeft = await getRetryQueueLength(campaign.id);
  const complete = cursor >= total && retryLeft === 0;

  if (complete) {
    await updateCampaign(campaign.id, { status: STATUSES.COMPLETED, completedAt: Date.now() });
    await setRunning(campaign.id, false);
  }

  return { sentThisTick, complete, rateLimited, dailyExhausted: dailyBudget <= 0 };
}

// ── Tick entry point ─────────────────────────────────────────────────

export async function processTick({ trigger = 'unknown' } = {}) {
  if (await isKillSwitchOn()) {
    await logSystem({ event: 'campaign_tick_skipped_killswitch', trigger });
    return { skipped: 'killswitch' };
  }

  const quality = await checkQualityGuardrail();
  if (quality.action === 'stop' || quality.action === 'pause') {
    return { skipped: `quality_${quality.action}`, rating: quality.rating };
  }

  const runningIds = await listRunningCampaignIds();
  if (!runningIds.length) return { skipped: 'no_running_campaigns' };

  const deadline = Date.now() + CONFIG.CAMPAIGNS.TICK_BUDGET_MS;
  let anySent = false;
  let anyStillRunning = false;

  for (const campaignId of runningIds) {
    if (Date.now() >= deadline) break;
    const campaign = await getCampaign(campaignId);
    if (!campaign || campaign.status !== STATUSES.RUNNING) continue;

    const result = await processCampaignTick(campaign, deadline);
    await updateCampaign(campaignId, { lastTickAt: Date.now() });
    if (result.sentThisTick > 0) anySent = true;
    if (!result.complete) anyStillRunning = true;

    await logSystem({
      event: 'campaign_tick',
      campaignId,
      trigger,
      sent: result.sentThisTick,
      complete: result.complete,
      rateLimited: result.rateLimited,
    });
  }

  if (anyStillRunning) {
    await selfChain(anySent ? 0 : SELF_CHAIN_DELAY_IDLE_MS);
  }

  return { anySent, anyStillRunning };
}

// ── Self-chaining trigger ────────────────────────────────────────────
// POST to our own tick endpoint to continue the chain. Uses the campaign
// secret for auth (same trust boundary as the cron endpoints elsewhere in
// this app). Delaying when idle avoids a tight busy-loop while every
// recipient is mid-backoff.
//
// Wrapped in waitUntil() — NOT plain fire-and-forget. A bare un-awaited
// fetch() can be killed by Vercel the instant the enclosing response is
// sent, since nothing tells the platform to keep the invocation alive for
// it. Found this live: zoho-sync.js had the identical un-awaited pattern,
// and a real sync silently stopped self-chaining after its first tick
// (imported count never moved again). waitUntil is what actually
// guarantees the background request completes.

async function selfChain(delayMs) {
  const url = `${CONFIG.PUBLIC_BASE_URL}/api/campaigns/process`;
  if (!CONFIG.PUBLIC_BASE_URL) return;
  const fire = async () => {
    if (delayMs > 0) await sleep(delayMs);
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'x-campaign-secret': process.env.CAMPAIGN_SECRET || '' },
      });
    } catch (err) {
      console.error('[campaign-sender] self-chain fetch failed', err.message);
    }
  };
  waitUntil(fire());
}
