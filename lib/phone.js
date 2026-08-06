// Phone-number normalisation for WhatsApp. WhatsApp expects digits only,
// in full international format, without '+' or separators.
import { CONFIG } from './env.js';

/**
 * @param {string|number|null|undefined} raw
 * @returns {string|null} normalised number (digits only) or null if unusable
 */
export function normalizePhone(raw) {
  if (raw === null || raw === undefined) return null;
  let digits = String(raw).replace(/[^\d]/g, '');
  if (!digits) return null;

  const cc = CONFIG.DEFAULT_COUNTRY_CODE; // e.g. "91"

  // Strip a single leading 0 (national trunk prefix) before applying cc.
  if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  // Bare 10-digit local number -> prepend country code.
  if (digits.length === 10) {
    digits = cc + digits;
  }

  // 00CC... international prefix -> drop the leading 00.
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  // Basic sanity: E.164 numbers are 8–15 digits.
  if (digits.length < 8 || digits.length > 15) return null;
  return digits;
}
