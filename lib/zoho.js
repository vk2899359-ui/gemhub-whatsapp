// Zoho CRM Leads client — paginated fetch, mapped into lib/leads.js's
// upsertLead shape. Field names confirmed against the live GemHub org:
// Mobile/Phone, Full_Name, Lead_Source, Tag (array of {name,...}),
// Last_Activity_Time.
import { CONFIG } from './env.js';
import { fetchWithRetry } from './http.js';
import { getZohoAccessToken } from './zoho-token.js';

const FIELDS = 'Full_Name,First_Name,Phone,Mobile,Lead_Source,Tag,Lead_Status,Last_Activity_Time,Created_Time';

async function zohoRequest(path, options = {}) {
  let token = await getZohoAccessToken();
  const url = `${CONFIG.ZOHO.API_BASE}/crm/v3/${path}`;
  const headers = () => ({
    Authorization: `Zoho-oauthtoken ${token}`,
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  });
  let res = await fetchWithRetry(
    url,
    { ...options, headers: headers() },
    { attempts: 3, baseDelayMs: 600, label: 'zoho:leads' }
  );
  if (res.status === 401) {
    token = await getZohoAccessToken({ forceRefresh: true });
    res = await fetchWithRetry(
      url,
      { ...options, headers: headers() },
      { attempts: 2, baseDelayMs: 600, label: 'zoho:leads:retry' }
    );
  }
  return res;
}

// Back-compat alias — existing GET call sites read more naturally this way.
const zohoFetch = (path) => zohoRequest(path);

function mapZohoLead(rec) {
  const phone = rec.Mobile || rec.Phone;
  if (!phone) return null;
  const tags = (rec.Tag || []).map((t) => t.name).filter(Boolean);
  const lastActivityAt = rec.Last_Activity_Time ? new Date(rec.Last_Activity_Time).getTime() : Date.now();
  return {
    phone,
    name: rec.Full_Name || rec.First_Name || '',
    source: rec.Lead_Source || 'zoho',
    tags,
    lastActivityAt,
    extra: { leadStatus: rec.Lead_Status || '', zohoId: rec.id },
  };
}

/**
 * Fetch one page of Leads. Returns { leads, nextPageToken, hasMore }.
 * @param {string|null} pageToken from a previous call's nextPageToken
 */
export async function fetchLeadsPage(pageToken) {
  const params = new URLSearchParams({
    fields: FIELDS,
    per_page: '200',
    sort_by: 'Modified_Time',
    sort_order: 'desc',
  });
  if (pageToken) params.set('page_token', pageToken);

  const res = await zohoFetch(`Leads?${params.toString()}`);
  if (res.status === 204) return { leads: [], nextPageToken: null, hasMore: false }; // no content = no more records
  const json = await res.json();
  if (!res.ok) throw new Error(`Zoho Leads fetch failed (${res.status}): ${JSON.stringify(json).slice(0, 300)}`);

  const leads = (json.data || []).map(mapZohoLead).filter(Boolean);
  return {
    leads,
    nextPageToken: json.info?.next_page_token || null,
    hasMore: Boolean(json.info?.more_records),
  };
}

/**
 * Push one WhatsApp contact into Zoho as a Lead. Uses the Upsert API with
 * Mobile as the duplicate-check field so a contact who already exists in
 * Zoho (e.g. from the CRM sync, or a repeat push) gets updated in place
 * rather than creating a second record. Last_Name is required by Zoho's
 * Leads module even though WhatsApp only ever gives us a single display
 * name — falls back to a generic label when Meta hasn't sent one.
 * @param {{phone:string, name?:string, domestic?:boolean, description?:string}} lead
 */
export async function upsertZohoLead({ phone, name, source, tags, domestic, description }) {
  // Zoho's Mobile field needs a leading "+" to dial correctly from the CRM's
  // click-to-call — WhatsApp gives us plain digits ("9198...") with no "+".
  // Same transform on every call site (push + description refresh) so the
  // duplicate-check on Mobile always resolves to the same existing record.
  const mobile = domestic ? `+${phone}` : phone;
  const body = {
    data: [
      {
        Last_Name: name || 'WhatsApp Lead',
        Mobile: mobile,
        Lead_Source: source || 'WhatsApp',
        ...(description ? { Description: description } : {}),
        ...(tags?.length ? { Tag: tags.map((t) => ({ name: t })) } : {}),
        // Lead_Type is a plain picklist (default "International") that the
        // IndiaMart integration sets explicitly on its own leads — WhatsApp
        // leads never had it set, so every one defaulted to International
        // regardless of actual phone. Country isn't derived from it (tested
        // live: changing Country alone doesn't move Lead_Type), so set both.
        ...(domestic !== undefined
          ? { Lead_Type: domestic ? 'Domestic' : 'International', ...(domestic ? { Country: 'IN' } : {}) }
          : {}),
      },
    ],
    duplicate_check_fields: ['Mobile'],
  };
  const res = await zohoRequest('Leads/upsert', { method: 'POST', body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Zoho Lead upsert failed (${res.status}): ${JSON.stringify(json).slice(0, 300)}`);

  const result = json.data?.[0];
  if (result?.status !== 'success') {
    throw new Error(`Zoho Lead upsert rejected: ${JSON.stringify(result).slice(0, 300)}`);
  }
  return result;
}
