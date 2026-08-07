// Lightweight, zero-latency language detection for canned system messages
// (handover, etc.) that must go out instantly — not worth an extra Claude
// call. The AI consultant itself matches language via its own prompt; this
// heuristic exists only for messages sent OUTSIDE the AI loop.
const DEVANAGARI_RE = /[ऀ-ॿ]/;

// Common romanised Hindi/Hinglish function words, checked with word
// boundaries so we don't false-positive on English words.
const HINGLISH_WORDS =
  /\b(hai|hain|nahi|nahin|kya|kaise|kyu|kyun|chahiye|karo|kar|kijiye|mujhe|humein|aap|aapka|aapki|batao|dikhao|karna|baat|bhai|didi|ji|acha|accha|theek|thik|paisa|paise|rupaye|rupees)\b/i;

/**
 * @param {string} text
 * @returns {'hi'|'hinglish'|'en'}
 */
export function detectLanguage(text) {
  const t = String(text || '');
  if (DEVANAGARI_RE.test(t)) return 'hi';
  if (HINGLISH_WORDS.test(t)) return 'hinglish';
  return 'en';
}
