// Self-chaining Zoho Leads sync, mirroring the campaign processor's design
// (bounded per-tick work, fire-and-forget continuation) so a 25,000+ lead
// pull never risks Vercel's 60s function timeout. Inert until
// ZOHO_CLIENT_ID/SECRET/REFRESH_TOKEN are configured — see README for the
// one-time Zoho "Self Client" setup.
import { waitUntil } from '@vercel/functions';
import { CONFIG, secrets, isZohoConfigured } from '../../lib/env.js';
import { fetchLeadsPage } from '../../lib/zoho.js';
import { upsertLeadsBatch, createLeadList, incrementListCount } from '../../lib/leads.js';
import { redis } from '../../lib/redis.js';
import { logSystem } from '../../lib/log.js';

const STATE_KEY = 'zoho:sync:state'; // hash: { listId, runId, pageToken, status, imported, startedAt }
// Vercel's hard function limit is 60s (vercel.json maxDuration). waitUntil()
// extends the invocation to let a background self-chain fetch complete, but
// does NOT bypass that hard cap — if the main work loop itself already ate
// most of the 60s, there's no time left for the chain to fire before the
// whole invocation is killed. Found live: a 45s budget meant real tick
// processing took ~47.5s wall-clock, leaving ~12s of an already-tight 60s
// window. 20s leaves a real ~40s/67% buffer.
const TICK_BUDGET_MS = 20000;

function newRunId() {
  // 'r' prefix guarantees this can never be all-digits — Upstash
  // deserializes purely-numeric-looking strings back into JS numbers on
  // read, which would break the strict === fencing-token comparison below.
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const provided = req.headers['x-campaign-secret'] || req.query.secret;
  let expected;
  try {
    expected = secrets.CAMPAIGN_SECRET;
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
  if (!provided || provided !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!isZohoConfigured()) {
    return res.status(400).json({
      error: 'Zoho is not configured. Set ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET and ZOHO_REFRESH_TOKEN, then redeploy.',
    });
  }

  const isStart = req.body?.action === 'start';
  let state = await redis().hgetall(STATE_KEY);

  if (isStart || !state?.listId) {
    const listId = 'zoho_' + Date.now();
    const runId = newRunId();
    await createLeadList({ id: listId, name: `Zoho sync ${new Date().toISOString().slice(0, 10)}`, sourceType: 'zoho' });
    state = { listId, runId, pageToken: '', status: 'running', imported: '0', startedAt: String(Date.now()) };
    await redis().hset(STATE_KEY, state);
    await logSystem({ event: 'zoho_sync_started', listId, runId });
  }

  // Fencing token: this invocation only acts on behalf of the run it read
  // above. If a newer 'start' supersedes it mid-flight (e.g. a manual
  // re-trigger while an earlier self-chain lineage is still alive), THIS
  // invocation's writes/self-chain are abandoned rather than clobbering the
  // newer run's progress. Found live: two overlapping sync lineages writing
  // to the same un-scoped state key produced wildly inconsistent counters
  // (imported count went backwards between UI refreshes).
  const myRunId = state.runId;
  const myListId = state.listId;

  const deadline = Date.now() + TICK_BUDGET_MS;
  let imported = Number(state.imported || 0);
  let pageToken = state.pageToken || null;
  let hasMore = true;
  let pagesThisTick = 0;

  try {
    while (hasMore && Date.now() < deadline) {
      const page = await fetchLeadsPage(pageToken || null);
      pagesThisTick++;
      // Pipelined batch write, not one sequential round trip per lead —
      // a plain per-lead loop here previously ran past both the tick
      // budget AND Vercel's function timeout mid-page (found live: a real
      // sync stalled at 58/187 leads with zero error logged, because a
      // hard timeout kill doesn't reach a catch block).
      const { imported: batchImported } = await upsertLeadsBatch(page.leads, myListId);
      imported += batchImported;
      pageToken = page.nextPageToken;
      hasMore = page.hasMore && Boolean(pageToken);
    }
  } catch (err) {
    const current = await redis().hget(STATE_KEY, 'runId');
    if (current === myRunId) {
      await redis().hset(STATE_KEY, { status: 'error', lastError: err.message });
    }
    await logSystem({ event: 'zoho_sync_error', listId: myListId, runId: myRunId, error: err.message });
    return res.status(502).json({ ok: false, error: err.message, importedSoFar: imported });
  }

  // Check the fencing token BEFORE writing anything back.
  const currentRunId = await redis().hget(STATE_KEY, 'runId');
  if (currentRunId !== myRunId) {
    await logSystem({ event: 'zoho_sync_superseded', listId: myListId, runId: myRunId, currentRunId });
    return res.status(200).json({ ok: true, superseded: true, listId: myListId });
  }

  await incrementListCount(myListId, imported - Number(state.imported || 0));
  await redis().hset(STATE_KEY, {
    pageToken: pageToken || '',
    imported: String(imported),
    status: hasMore ? 'running' : 'done',
  });

  await logSystem({ event: 'zoho_sync_tick', listId: myListId, runId: myRunId, pagesThisTick, imported, hasMore });

  if (hasMore) {
    waitUntil(selfChain());
  }

  return res.status(200).json({ ok: true, listId: myListId, imported, hasMore, pagesThisTick });
}

// Wrapped in waitUntil() at the call site above — a bare un-awaited fetch()
// can be killed by Vercel the instant the response is sent, since nothing
// tells the platform to keep this invocation alive for it.
async function selfChain() {
  if (!CONFIG.PUBLIC_BASE_URL) return;
  try {
    await fetch(`${CONFIG.PUBLIC_BASE_URL}/api/campaigns/zoho-sync`, {
      method: 'POST',
      headers: { 'x-campaign-secret': process.env.CAMPAIGN_SECRET || '', 'Content-Type': 'application/json' },
      body: '{}',
    });
  } catch (err) {
    console.error('[zoho-sync] self-chain failed', err.message);
  }
}
