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

const STATE_KEY = 'zoho:sync:state'; // hash: { listId, pageToken, status, imported, startedAt }
const TICK_BUDGET_MS = 45000;

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
    await createLeadList({ id: listId, name: `Zoho sync ${new Date().toISOString().slice(0, 10)}`, sourceType: 'zoho' });
    state = { listId, pageToken: '', status: 'running', imported: '0', startedAt: String(Date.now()) };
    await redis().hset(STATE_KEY, state);
  }

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
      const { imported: batchImported } = await upsertLeadsBatch(page.leads, state.listId);
      imported += batchImported;
      pageToken = page.nextPageToken;
      hasMore = page.hasMore && Boolean(pageToken);
    }
  } catch (err) {
    await redis().hset(STATE_KEY, { status: 'error', lastError: err.message });
    await logSystem({ event: 'zoho_sync_error', error: err.message });
    return res.status(502).json({ ok: false, error: err.message, importedSoFar: imported });
  }

  await incrementListCount(state.listId, imported - Number(state.imported || 0));
  await redis().hset(STATE_KEY, {
    pageToken: pageToken || '',
    imported: String(imported),
    status: hasMore ? 'running' : 'done',
  });

  await logSystem({ event: 'zoho_sync_tick', listId: state.listId, pagesThisTick, imported, hasMore });

  if (hasMore) {
    waitUntil(selfChain());
  }

  return res.status(200).json({ ok: true, listId: state.listId, imported, hasMore, pagesThisTick });
}

// Wrapped in waitUntil() at the call site above — a bare un-awaited fetch()
// can be killed by Vercel the instant the response is sent, since nothing
// tells the platform to keep this invocation alive for it. This was the
// actual reason a live sync stopped self-chaining after its first tick
// (imported count stopped moving, no error logged) — waitUntil is what
// guarantees the background request completes.
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
