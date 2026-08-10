// Opt-out detection for bulk campaigns — mandatory, checked on every inbound
// message regardless of conversation state. Suppression is scoped to
// CAMPAIGN sends only (lib/campaigns.js's suppression list); it does not
// silence the support bot itself, matching standard WhatsApp/SMS opt-out
// semantics (stop promos, not stop all contact).
//
// Deliberately two-tier: a bare "stop" is only treated as opt-out when it IS
// (close to) the whole message — the industry-standard SMS/WhatsApp
// convention. A bare \bstop\b substring match would false-positive on
// completely unrelated sentences like "I want to stop by your showroom" or
// "can you stop sending the wrong size" (caught by testing before this
// shipped). Longer phrases are only matched when they explicitly reference
// messaging/subscription, not just the word "stop" in isolation.
//
// Deliberately biased toward false positives over false negatives: a wrongly
// detected opt-out just excludes someone from future campaigns (fixable any
// time from the dashboard's suppression list); a missed real opt-out means
// messaging someone who explicitly asked to stop, which is the actually
// dangerous failure mode for a "mandatory" compliance feature.
const EXACT_KEYWORDS = new Set([
  'stop',
  'stop all',
  'stop please',
  'please stop',
  'pls stop',
  'unsubscribe',
  'opt out',
  'optout',
  'opt-out',
  'cancel',
  'cancel subscription',
]);

const PHRASE_RE =
  /\b(unsubscribe|opt[\s-]?out|remove me|no more messages?|don'?t (message|text|send)( me)?|stop (messaging|texting|sending)( me)?|stop (this|these|all)\s+messages?)\b|बंद\s*(करो|कर\s*दो|कीजिए)|मत\s*भेजो|हटाओ\s*मुझे|सदस्यता\s*(समाप्त|रद्द)|band\s*kar(o|do)?|mat\s*bhejo|hatao\s*mujhe|rok\s*do/i;

export function isOptOutMessage(text) {
  const normalized = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/, '');
  if (EXACT_KEYWORDS.has(normalized)) return true;
  return PHRASE_RE.test(String(text || ''));
}

export function optOutConfirmationMessage(lang) {
  if (lang === 'hi') {
    return 'आपको GemHub के प्रचार संदेशों से अनसब्सक्राइब कर दिया गया है — अब आपको हमारी तरफ़ से मार्केटिंग मैसेज नहीं मिलेंगे। 🙏 ऑर्डर या सहायता के लिए आप कभी भी यहाँ संपर्क कर सकते हैं।';
  }
  if (lang === 'hinglish') {
    return 'Aapko GemHub ke promotional messages se unsubscribe kar diya gaya hai — ab aapko marketing messages nahi milenge. 🙏 Order ya support ke liye aap kabhi bhi yahan message kar sakte hain.';
  }
  return "You're unsubscribed from GemHub promotions and won't receive further marketing messages from us. 🙏 You can still reach us here anytime for orders or support.";
}
