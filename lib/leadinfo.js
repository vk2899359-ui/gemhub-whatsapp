// Lightweight, zero-latency heuristics for surfacing lead signals (budget,
// occasion) from raw message text — used by both the human-handover lead
// summary and the CRM dashboard. Not authoritative; a best-effort hint for a
// human reading the real transcript, not a data-entry replacement.
const BUDGET_RE =
  /(?:₹\s?[\d,]+(?:\.\d+)?\s?(?:k|K|lakh|lac|lakhs|crore)?)|(?:\b\d{2,3}\s?k\b)|(?:\b\d(?:\.\d+)?\s?lakh[s]?\b)|(?:\bbudget\s*(?:is|hai|ka)?\s*[:\-]?\s*₹?\s?[\d,]+)/i;

const OCCASION_RE =
  /\b(engagement|wedding|shaadi|marriage|anniversary|birthday|gift|propose|proposal|self|honeymoon)\b|सगाई|शादी|सालगिरह|जन्मदिन|तोहफा/i;

const OBJECTION_RE =
  /\b(too expensive|expensive|costly|out of budget|can'?t afford|discount|lower price|cheaper)\b|mehenga|mehngi|sasta|kam (karo|karein)|discount (do|milega)|महंगा|सस्ता|छूट/i;

export function extractBudgetMention(text) {
  const m = String(text || '').match(BUDGET_RE);
  return m ? m[0].trim() : null;
}

export function extractOccasionMention(text) {
  const m = String(text || '').match(OCCASION_RE);
  return m ? m[0].trim().toLowerCase() : null;
}

export function hasObjectionLanguage(text) {
  return OBJECTION_RE.test(String(text || ''));
}
