// Chunked CSV lead upload. The dashboard parses the CSV client-side and
// POSTs bounded batches (avoids Vercel's request-body limit and keeps each
// call well under the function timeout for large imports) — this endpoint
// just upserts one batch and is safe to call repeatedly for the same list.
import { requireAuth } from '../../../lib/dashboardAuth.js';
import { upsertLead, createLeadList, incrementListCount } from '../../../lib/leads.js';
import { logSystem } from '../../../lib/log.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  if (!requireAuth(req, res)) return;

  const { listId, listName, isFirstBatch, rows } = req.body || {};
  if (!listId || !Array.isArray(rows)) {
    return res.status(400).json({ error: 'Missing listId or rows' });
  }
  if (rows.length > 2000) {
    return res.status(400).json({ error: 'Batch too large — send at most 2000 rows per request' });
  }

  if (isFirstBatch) {
    await createLeadList({ id: listId, name: listName || listId, sourceType: 'csv' });
  }

  let imported = 0;
  const invalid = [];
  for (const row of rows) {
    const phone = await upsertLead({
      phone: row.phone,
      name: row.name,
      source: row.source || 'csv_upload',
      tags: row.tags,
      lastActivityAt: row.lastActivityAt,
      extra: row.extra,
      listId,
    });
    if (phone) imported++;
    else invalid.push(row.phone);
  }
  if (imported > 0) await incrementListCount(listId, imported);

  await logSystem({ event: 'lead_batch_uploaded', listId, imported, invalidCount: invalid.length });

  return res.status(200).json({ ok: true, imported, invalid: invalid.length, invalidSample: invalid.slice(0, 20) });
}
