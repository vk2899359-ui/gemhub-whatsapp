// Lead storage for bulk campaigns — separate from the customer CRM
// (lib/conversations.js), since a lead is a prospect who hasn't necessarily
// ever messaged the bot. Backed by one hash per lead (keyed by normalised
// phone) plus recency/tag/source/list index sets for fast audience building.
import { redis } from './redis.js';
import { normalizePhone } from './phone.js';

const LEADS_ALL = 'leads:all'; // ZSET, score = importedAt
const k = {
  lead: (phone) => `lead:${phone}`,
  bySource: (source) => `leads:source:${slug(source)}`,
  byTag: (tag) => `leads:tag:${slug(tag)}`,
  byList: (listId) => `leads:list:${listId}`,
  listMeta: (listId) => `leadlist:${listId}`,
};

const LEAD_LISTS = 'leadlists'; // ZSET, score = createdAt

function slug(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .slice(0, 60);
}

/**
 * @param {{phone:string, name?:string, source?:string, tags?:string[],
 *   lastActivityAt?:number, extra?:object, listId:string}} lead
 * @returns {Promise<string|null>} normalised phone, or null if invalid
 */
export async function upsertLead(lead) {
  const phone = normalizePhone(lead.phone);
  if (!phone) return null;

  const r = redis();
  const now = Date.now();
  const tags = (lead.tags || []).map(String).filter(Boolean);

  const record = {
    phone,
    name: lead.name || '',
    source: lead.source || '',
    tags: JSON.stringify(tags),
    lastActivityAt: String(lead.lastActivityAt || now),
    extra: JSON.stringify(lead.extra || {}),
    listId: lead.listId || '',
    importedAt: String(now),
  };

  await r.hset(k.lead(phone), record);
  await r.zadd(LEADS_ALL, { score: now, member: phone });
  if (lead.source) await r.sadd(k.bySource(lead.source), phone);
  for (const t of tags) await r.sadd(k.byTag(t), phone);
  if (lead.listId) await r.sadd(k.byList(lead.listId), phone);

  return phone;
}

export async function createLeadList({ id, name, sourceType }) {
  await redis().hset(k.listMeta(id), {
    id,
    name: name || id,
    sourceType: sourceType || 'csv',
    createdAt: String(Date.now()),
    count: '0',
  });
  await redis().zadd(LEAD_LISTS, { score: Date.now(), member: id });
}

/** Incremental — safe to call once per uploaded batch (chunked CSV import,
 * paginated Zoho sync) without the caller needing to track a running total. */
export async function incrementListCount(id, by) {
  await redis().hincrby(k.listMeta(id), 'count', by);
}

export async function listLeadLists() {
  const ids = (await redis().zrange(LEAD_LISTS, 0, -1, { rev: true })).map(String);
  if (!ids.length) return [];
  const pipeline = redis().pipeline();
  for (const id of ids) pipeline.hgetall(k.listMeta(id));
  const results = await pipeline.exec();
  // id explicitly last: overrides the hash's own (possibly number-coerced)
  // id field with the already-string id from the ZSET.
  return ids.map((id, i) => ({ ...results[i], count: Number(results[i]?.count || 0), id }));
}

export async function getLeadCount() {
  return redis().zcard(LEADS_ALL);
}

/** Pipelined fetch of a bounded batch of phones' full lead hashes. */
async function hydrateLeads(phones) {
  if (!phones.length) return [];
  const r = redis();
  const pipeline = r.pipeline();
  for (const phone of phones) pipeline.hgetall(k.lead(phone));
  const results = await pipeline.exec();
  return phones.map((phone, i) => parseLead(phone, results[i]));
}

function parseLead(phone, h) {
  if (!h) return { phone, name: '', source: '', tags: [], lastActivityAt: 0, extra: {}, listId: '' };
  let tags = [];
  let extra = {};
  try {
    tags = JSON.parse(h.tags || '[]');
  } catch {
    /* ignore */
  }
  try {
    extra = JSON.parse(h.extra || '{}');
  } catch {
    /* ignore */
  }
  return {
    phone: String(phone),
    name: h.name || '',
    source: h.source || '',
    tags,
    lastActivityAt: Number(h.lastActivityAt || 0),
    extra,
    listId: h.listId || '',
  };
}

const CHUNK = 500; // bounded pipeline size for large audience scans

async function intersectSets(setKeys) {
  if (!setKeys.length) return null; // null = "no constraint from this dimension"
  const r = redis();
  let acc = null;
  for (const key of setKeys) {
    const members = new Set((await r.smembers(key)).map(String));
    acc = acc === null ? members : new Set([...acc].filter((m) => members.has(m)));
    if (acc.size === 0) break;
  }
  return acc || new Set();
}

/**
 * Resolve an audience filter into a fully-hydrated lead list. Chunks large
 * scans (e.g. "full list + last-activity filter" over 25k+ leads) into
 * bounded pipelined batches — this only runs at campaign-build time, never
 * in a polling loop.
 * @param {{tag?:string, source?:string, listId?:string, lastActivityWithinDays?:number}} filter
 */
export async function resolveAudience(filter = {}) {
  const r = redis();
  const constraints = [];
  if (filter.tag) constraints.push(k.byTag(filter.tag));
  if (filter.source) constraints.push(k.bySource(filter.source));
  if (filter.listId) constraints.push(k.byList(filter.listId));

  let phones;
  if (constraints.length) {
    const set = await intersectSets(constraints);
    phones = [...set];
  } else {
    phones = (await r.zrange(LEADS_ALL, 0, -1)).map(String);
  }

  if (!filter.lastActivityWithinDays) {
    return hydrateInChunks(phones);
  }

  const cutoff = Date.now() - filter.lastActivityWithinDays * 24 * 60 * 60 * 1000;
  const hydrated = await hydrateInChunks(phones);
  return hydrated.filter((l) => l.lastActivityAt >= cutoff);
}

async function hydrateInChunks(phones) {
  const out = [];
  for (let i = 0; i < phones.length; i += CHUNK) {
    out.push(...(await hydrateLeads(phones.slice(i, i + CHUNK))));
  }
  return out;
}

export async function listSources() {
  // Sources are discovered as sadd keys; cheap to enumerate via a small
  // known-prefix scan since the total distinct-source count is small.
  return scanKeySuffixes('leads:source:');
}
export async function listTags() {
  return scanKeySuffixes('leads:tag:');
}

async function scanKeySuffixes(prefix) {
  const r = redis();
  let cursor = '0';
  const out = [];
  do {
    const [next, keys] = await r.scan(cursor, { match: `${prefix}*`, count: 200 });
    cursor = next;
    for (const key of keys) out.push(key.slice(prefix.length));
  } while (cursor !== '0');
  return out;
}
