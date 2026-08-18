// Anthropic Claude client for the GemHub sales consultant. Runs a bounded
// tool-use loop so Claude can look up live products and then compose the reply
// by choosing a WhatsApp format (text, menu, product cards, location, booking,
// escalation). It returns a list of render "actions" for the webhook to send —
// it does not touch WhatsApp itself.
import { CONFIG, secrets } from './env.js';
import { fetchWithRetry } from './http.js';
import { searchProductsDetailed } from './shopify.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const S = CONFIG.SHOWROOM;

const SYSTEM_PROMPT = `You are the senior sales consultant for GemHub (Hamlet E Commerce Pvt Ltd), a luxury fine-jewellery house. You have 10+ years selling diamonds and fine jewellery to Indian buyers, and you are chatting with a customer on WhatsApp right now.

# Who you are
- Your name is Sonia. When you introduce yourself, or when a customer asks who they're speaking with, say you're Sonia from GemHub — nothing more elaborate.
- Warm, personal and genuinely helpful — a trusted advisor, never robotic and never a wall of text.
- You match the customer's language EXACTLY: Hindi → Hindi, Hinglish → Hinglish, English → English. Mirror their script and register.
- You text like a real consultant: short, human, confident. 2–4 short lines, then let the buttons do the work. Never paragraphs.
- NEVER invent any other staff member's name (no "Mr. X will call you", no "our expert Y will connect with you"). You are the one person the customer is talking to — if a human needs to take over, that's handled by escalation (unable_to_help), not by promising a named colleague will follow up.

# What you sell (never invent anything beyond this)
- IGI-certified lab-grown diamonds and GRA-certified moissanite.
- Set in 18k gold, gold vermeil, and 950 platinum.
- Custom & CAD design, old-gold exchange, try-at-home, free insured shipping across India.

# How you sell (this is the whole point)
1. Qualify early and naturally — weave in occasion, budget range, recipient and timeline as conversation, not an interrogation. One question at a time.
2. Recommend specifically. Never dump the catalogue. Curate 2–3 pieces with a short reason for each ("the halo makes the centre stone look a size bigger").
3. Anchor on value, not price: IGI/GRA certification, direct-from-factory pricing with no middleman markup, custom CAD design, old-gold exchange, free insured shipping. Price is never the headline — value is.
4. Every reply ends with a next step: a question, a set of options, or a clear CTA. Never a dead end.
5. Handle objections like a pro:
   - "Too expensive" → reaffirm the value, then offer a lower-tier piece in the SAME style (smaller carat, vermeil vs 18k). Never defensive.
   - "Just looking / just browsing" → no pressure at all. Offer to send a few pieces they'd love and invite them to see in person. Warm, relaxed.
   - "Is lab-grown real?" → yes: chemically and optically identical to mined diamond, IGI-certified, at a fraction of the price. Same fire, same hardness — only origin and price differ.
   - An unreasonable ask (discount far beyond policy, an impossible timeline, a free upgrade) → stay warm and calm, explain plainly what's not possible and why, then immediately pivot to what you CAN offer instead. Never sound short, dismissive or annoyed — a "no" from you should still feel like good service.

# Hard rules
- Never invent prices, stock or delivery dates. ALWAYS call lookup_products before quoting or recommending anything.
- If a customer asks "price?" / "kitna hai?" / "how much" without naming or clearly identifying a specific piece — very common when they clicked one of many different ads and assume you already know which — do NOT guess or quote a generic starting price. Ask them to share a photo or screenshot of the exact piece they mean (or its name/link if they have it), so you can confirm it in the catalogue and give the correct price. Only after you can identify the exact piece (from their photo, description, or a prior message in this conversation) should you call lookup_products and quote.
- Never discount beyond what the store already offers.
- No pushy, desperate or fake-urgency language ("only 2 left!", "offer ends tonight!"). This is a luxury brand — calm confidence.
- Keep replies to 2–4 short lines plus buttons. If it's becoming a paragraph, trim it.
- Escalate (unable_to_help) for: bulk/corporate/wholesale enquiries, complaints, or any explicit request to speak to a person.
- When you confirm a showroom booking (send_booking after a slot is picked), confirm the date/time back plainly and close with the real showroom phone and email (given below) so the customer has a direct line if plans change. Do not promise any named person will call — you're the one confirming it.
- If a customer sends a photo and you genuinely cannot match it to anything in the catalogue, never leave it as a dead end. Say so honestly in one line, then immediately do ONE of: ask the specific detail that would help you search better (which ad/page they saw it on, approximate carat/metal/budget), or offer to pass the photo to the design team for a custom quote — always end with a concrete next step, never just "I couldn't identify it."

# How you actually reply
Compose the customer-facing text yourself in their language, and deliver it by choosing ONE tool per turn (use lookup_products first if you need live data):
- lookup_products — fetch live pieces from Shopify (image, price, IGI/GRA cert, metal). Use before recommending or quoting.
- send_menu — your reply text + the default menu (Browse Jewellery / Book Showroom Visit / Custom Design). Good for openings or when the customer is unsure.
- send_products — show real product images with catalogue captions + a pick-list. Pass the ids from lookup_products (up to 4).
- send_location — your reply text + the showroom pin and a Get Directions link. Use on any "where / can I visit / directions" intent.
- send_booking — your reply text + the time-slot list to book a showroom visit.
- send_after_products_menu — follow-up buttons (See More / Book a Visit / Talk to Expert) after showing pieces.
- unable_to_help — hand off to a human (bulk/corporate, complaint, or explicit human request).
If a plain text reply is enough (a question, objection handling, small talk), just reply with text and don't call a tool.

# Business facts you can state
- Showroom: ${S.address}
- Open ${S.hours}
- WhatsApp: ${S.phone} · Email: ${S.email}
- Free insured shipping across India. Custom & CAD design, old-gold exchange, try-at-home.`;

// Injected when the conversation is ad-sourced: open with a qualifying
// question rather than a generic greeting.
const AD_SOURCED_HINT = `[Context: This customer arrived from a Google Ads lab-grown-diamond campaign and opened with the ad starter message. They are high-intent. Do NOT open with a generic greeting or the default menu. Open warmly and immediately qualify — ask about the occasion (engagement, gift, self, wedding) in their language, in one short line, and make it easy to answer. GemHub runs ads on many different products at once, so if they ask about price without saying which piece, you have no way to know which ad they clicked — ask them to share a photo or screenshot of the exact piece before quoting anything.]`;

const IMAGE_MESSAGE_HINT = `[Context: The customer just sent a photo, most likely a jewellery piece they saw somewhere (Instagram, Pinterest, another store, a friend's ring) and want to know if GemHub has something similar, or a photo of their own hand/finger for sizing, or a screenshot of a GemHub product. Describe what you can see (style, stone shape, setting type, metal tone) in one short line, then use lookup_products. When candidates come back, lookup_products also attaches each one's actual product photo — genuinely LOOK at those photos side-by-side with the customer's photo before deciding.

If the photo is a screenshot of an ad or post (visible caption text, "gemhub.in"/GemHub branding, a "Follow"/CTA button, price or offer text baked into the image) — this is almost always OUR OWN ad for a real catalogue product, not a random reference photo. READ any visible text in the screenshot first (captions, offer text, partial product description) — it often names or strongly hints at the exact piece — and search using that specific wording before falling back to visual style guessing. In this case the goal is finding the EXACT SKU, not "something similar."

A product whose title merely sounds similar is NOT the same as one that visually matches — judge the actual photo, not just the name.

CRITICAL — search query length: the catalogue search returns FAR fewer (often zero) results for a long, specific, multi-word query than for a short 2-4 word one, even when the exact product exists. A query like "round diamond cushion halo engagement ring white gold" will very likely return nothing; "diamond ring" or "halo ring" for the exact same piece returns it near the top. So: search with 2-4 words only (main category + at most one defining feature, e.g. "solitaire ring", "halo ring", "diamond pendant"), never a long descriptive phrase. If a short search comes back empty or without a visual match, try 1-2 MORE short searches using different individual features you saw (shape, then setting, then stone) before concluding it doesn't exist — only after that say "we don't have this" and offer custom design. This is very often an EXISTING catalogue piece that a badly-worded search simply missed.]`;

const CAMPAIGN_SOURCED_HINT = (offerText) =>
  `[Context: This customer is replying to a WhatsApp marketing broadcast they were sent. The exact message they received was: "${offerText}". Stay on-topic about THIS specific offer/piece/price — do not open generically or ask what they're looking for as if this were a cold conversation. Reference the piece and price naturally, answer their question about it, and guide them toward booking a viewing or continuing the purchase.]`;

const TOOLS = [
  {
    name: 'lookup_products',
    description:
      'Search the live GemHub catalogue by name, type, gemstone, occasion or keyword. Returns real ids, titles, prices, certification, metal and availability. Use before quoting a price or recommending pieces.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'SHORT search terms only — 2-4 words (e.g. "solitaire engagement ring", "moissanite studs", "halo ring"). Longer, more specific phrases return far fewer or zero results even for products that exist — never combine many descriptive words into one query.',
        },
        limit: { type: 'integer', description: 'How many pieces to fetch (default 4, max 10).' },
      },
      required: ['query'],
    },
  },
  {
    name: 'send_menu',
    description:
      'Send your reply text with the default 3-button menu (Browse Jewellery / Book Showroom Visit / Custom Design). Good for openings or when the customer is unsure.',
    input_schema: {
      type: 'object',
      properties: { message: { type: 'string', description: "Your reply text in the customer's language." } },
      required: ['message'],
    },
  },
  {
    name: 'send_products',
    description:
      'Show real product images with catalogue-style captions (up to 4) plus a pick-list, or a single product with a View Product link. Pass ids from lookup_products.',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: "Short lead-in text in the customer's language." },
        product_ids: { type: 'array', items: { type: 'string' }, description: 'Ids from lookup_products (up to 4).' },
      },
      required: ['message', 'product_ids'],
    },
  },
  {
    name: 'send_location',
    description:
      'Send your reply text plus the showroom location pin and a Get Directions link. Use on any location / "where are you" / "can I visit" intent.',
    input_schema: {
      type: 'object',
      properties: { message: { type: 'string', description: "Short lead-in text in the customer's language." } },
      required: ['message'],
    },
  },
  {
    name: 'send_booking',
    description: 'Send your reply text plus the showroom time-slot list (10 AM–7 PM) so the customer can book a visit.',
    input_schema: {
      type: 'object',
      properties: { message: { type: 'string', description: "Short lead-in text in the customer's language." } },
      required: ['message'],
    },
  },
  {
    name: 'send_after_products_menu',
    description: 'Send follow-up buttons (See More / Book a Visit / Talk to Expert) after showing pieces.',
    input_schema: {
      type: 'object',
      properties: { message: { type: 'string', description: "Short lead-in text in the customer's language." } },
      required: ['message'],
    },
  },
  {
    name: 'unable_to_help',
    description:
      'Call when the customer explicitly asks for a human/agent, for bulk/corporate/wholesale enquiries or complaints, or when you cannot resolve the request after trying. Give a short reason.',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string' },
        explicit_human_request: {
          type: 'boolean',
          description: 'true if the customer directly asked to talk to a person/agent.',
        },
      },
      required: ['reason'],
    },
  },
];

async function callAnthropic(messages, system) {
  const res = await fetchWithRetry(
    ANTHROPIC_URL,
    {
      method: 'POST',
      headers: {
        'x-api-key': secrets.ANTHROPIC_API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: CONFIG.ANTHROPIC_MODEL,
        max_tokens: 900,
        system,
        tools: TOOLS,
        messages,
      }),
    },
    { attempts: 3, baseDelayMs: 800, label: 'anthropic:messages' }
  );

  const json = await res.json();
  if (!res.ok) {
    throw new Error(
      `Anthropic error (${res.status}): ${json?.error?.message || JSON.stringify(json)}`
    );
  }
  return json;
}

const SEND_TOOLS = new Set([
  'send_menu',
  'send_products',
  'send_location',
  'send_booking',
  'send_after_products_menu',
]);

/**
 * Generate a reply for the customer.
 * @param {{history: Array<{role:string, content:any}>, userText: string, adSourced?: boolean}} args
 * @returns {Promise<{actions: Array<object>, wantsHuman: boolean, unableCount: number, reason: string|null}>}
 *
 * Actions (rendered by the webhook): {kind:'text',body} | {kind:'menu',body} |
 * {kind:'products',body,products} | {kind:'after_products',body} |
 * {kind:'location',body} | {kind:'booking',body}
 */
export async function generateReply({ history, userText, adSourced = false, campaignOffer = null, image = null }) {
  let system = adSourced ? `${SYSTEM_PROMPT}\n\n${AD_SOURCED_HINT}` : SYSTEM_PROMPT;
  if (campaignOffer) {
    system += `\n\n${CAMPAIGN_SOURCED_HINT(campaignOffer)}`;
  }
  if (image) {
    system += `\n\n${IMAGE_MESSAGE_HINT}`;
  }
  // A user turn is normally a plain string; with an attached photo it
  // becomes a content-block array (image + the caption/question text) —
  // Claude's vision input shape. Only this one turn needs it; prior history
  // turns stay as whatever they already were (never re-sent as images).
  const userContent = image
    ? [
        { type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.base64 } },
        { type: 'text', text: userText || 'What do you think of this piece? Do you have something like it?' },
      ]
    : userText;
  const messages = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: userContent },
  ];

  const productCache = new Map();
  let wantsHuman = false;
  let unableCount = 0;
  let reason = null;

  for (let i = 0; i < 5; i++) {
    const res = await callAnthropic(messages, system);

    if (res.stop_reason === 'tool_use') {
      const toolResults = [];
      const actions = [];

      for (const block of res.content) {
        if (block.type !== 'tool_use') continue;

        if (block.name === 'lookup_products') {
          let content;
          try {
            const found = await searchProductsDetailed(
              String(block.input?.query || ''),
              Number(block.input?.limit) || (image ? 8 : 4)
            );
            found.forEach((p) => productCache.set(p.id, p));
            if (!found.length) {
              content = `No products found matching "${block.input?.query}". Do not invent details.`;
            } else if (image) {
              // The customer sent a photo — a text-only keyword match isn't
              // enough to honestly call something "no match" or "a match".
              // Attach each candidate's actual product photo so the model
              // visually compares them against the customer's photo instead
              // of guessing from the title alone.
              content = [
                {
                  type: 'text',
                  text: `Candidate products found (compare each photo below against the customer's photo before deciding if any is a genuine style match):\n${JSON.stringify(
                    found.map((p) => ({
                      id: p.id,
                      title: p.title,
                      price: p.price,
                      certification: p.cert,
                      metal: p.metal,
                      available: p.available,
                    }))
                  )}`,
                },
                ...found
                  .filter((p) => p.image)
                  .flatMap((p) => [
                    { type: 'text', text: `Photo for product id ${p.id} ("${p.title}"):` },
                    { type: 'image', source: { type: 'url', url: p.image } },
                  ]),
              ];
            } else {
              content = JSON.stringify(
                found.map((p) => ({
                  id: p.id,
                  title: p.title,
                  price: p.price,
                  certification: p.cert,
                  metal: p.metal,
                  available: p.available,
                  has_image: Boolean(p.image),
                }))
              );
            }
          } catch (err) {
            content = `Product lookup is temporarily unavailable (${err.message}). Do not invent details; offer to check and follow up.`;
          }
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content });
          continue;
        }

        if (SEND_TOOLS.has(block.name)) {
          const body = String(block.input?.message || '').trim();
          if (block.name === 'send_menu') actions.push({ kind: 'menu', body });
          else if (block.name === 'send_location') actions.push({ kind: 'location', body });
          else if (block.name === 'send_booking') actions.push({ kind: 'booking', body });
          else if (block.name === 'send_after_products_menu') actions.push({ kind: 'after_products', body });
          else if (block.name === 'send_products') {
            const ids = block.input?.product_ids || [];
            const products = ids.map((id) => productCache.get(id)).filter(Boolean).slice(0, 4);
            actions.push({ kind: 'products', body, products });
          }
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'sent' });
          continue;
        }

        if (block.name === 'unable_to_help') {
          unableCount++;
          reason = block.input?.reason || 'unresolved';
          if (block.input?.explicit_human_request) wantsHuman = true;
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content:
              'Acknowledged — a human specialist will follow up. The webhook will hand off; you do not need to reply further.',
          });
        }
      }

      // A send tool produced the reply — deliver it.
      if (actions.length) {
        return { actions, wantsHuman, unableCount, reason };
      }
      // If escalation was requested (and nothing to send), hand off.
      if (wantsHuman) {
        return { actions: [], wantsHuman, unableCount, reason };
      }

      // Otherwise (e.g. a lookup) continue the loop for another turn.
      messages.push({ role: 'assistant', content: res.content });
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // Terminal plain-text response.
    const text = (res.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    if (wantsHuman) return { actions: [], wantsHuman, unableCount, reason };

    return {
      actions: [
        {
          kind: 'text',
          body:
            text ||
            'Sorry, I didn’t quite catch that 🙏 Could you tell me a little more about what you’re looking for?',
        },
      ],
      wantsHuman,
      unableCount,
      reason,
    };
  }

  // Safety valve if the tool loop runs away.
  return {
    actions: [],
    wantsHuman: true,
    unableCount: unableCount || 1,
    reason: reason || 'max_tool_turns',
  };
}
