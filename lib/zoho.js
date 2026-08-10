// Zoho CRM Leads client — paginated fetch, mapped into lib/leads.js's
// upsertLead shape. Field names confirmed against the live GemHub org:
// Mobile/Phone, Full_Name, Lead_Source, Tag (array of {name,...}),
// Last_Activity_Time.
import { CONFIG } from './env.js';
import { fetchWithRetry } from './http.js';
import { getZohoAccessToken } from './zoho-token.js';

const FIELDS = 'Full_Name,First_Name,Phone,Mobile,Lead_Source,Tag,Lead_Status,Last_Activity_Time,Created_Time';

async function zohoFetch(path) {
  let token = await getZohoAccessToken();
  const url = `${CONFIG.ZOHO.API_BASE}/crm/v3/${path}`;
  let res = await fetchWithRetry(
    url,
    { headers: { Authorization: `Zoho-oauthtoken ${token}` } },
    { attempts: 3, baseDelayMs: 600, label: 'zoho:leads' }
  );
  if (res.status === 401) {
    token = await getZohoAccessToken({ forceRefresh: true });
    res = await fetchWithRetry(
      url,
      { headers: { Authorization: `Zoho-oauthtoken ${token}` } },
      { attempts: 2, baseDelayMs: 600, label: 'zoho:leads:retry' }
    );
  }
  return res;
}

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
