// Anthropic Claude client for the GemHub sales assistant. Runs a bounded
// tool-use loop so Claude can look up live product data before replying.
import { CONFIG, secrets } from './env.js';
import { fetchWithRetry } from './http.js';
import { searchProducts } from './shopify.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const SYSTEM_PROMPT = `You are the sales assistant for GemHub, a jewellery brand.

ABOUT GEMHUB
- We sell IGI-certified lab-grown diamond jewellery and GRA-certified moissanite jewellery.
- Physical showroom: 2nd Floor, Unit 201, Greenwood Plaza, Sector 45, Gurugram. Open 10 AM–7 PM daily.
- Free insured shipping across India.
- We offer custom CAD design and old-gold exchange.
- Support email: care@gemhub.in.

YOUR STYLE
- Warm, genuine and helpful — never pushy or salesy.
- Reply in the SAME language the customer uses: Hindi, Hinglish, or English. Match their tone.
- Keep replies short and WhatsApp-friendly (a few lines, tasteful emoji ok).

HARD RULES
- NEVER invent prices, discounts, stock levels, product names, or certificate details.
  If you don't have a fact, say you'll check, or use the lookup_product tool.
- When a customer asks about a specific product, price, or availability, ALWAYS call
  the lookup_product tool and base your answer strictly on what it returns.
- For high-intent buyers (ready to buy, asking to see pieces, bridal/engagement, custom
  design), warmly invite them to visit the Sector 45, Gurugram showroom.
- If the customer asks to speak to a person/human/agent, or you genuinely cannot help
  after trying, call the unable_to_help tool so a human can take over.
- Do not promise anything about delivery dates, refunds, or policies you are unsure of;
  point to care@gemhub.in instead.`;

const TOOLS = [
  {
    name: 'lookup_product',
    description:
      'Search the live GemHub catalogue for products by name, type, gemstone, or keyword. Returns real titles, prices, availability and URLs. Use before quoting any price or stock.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Search terms, e.g. "solitaire ring", "moissanite earrings", "tennis bracelet".',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'unable_to_help',
    description:
      'Call this when the customer explicitly asks for a human/agent, or when you cannot resolve their request after trying. Provide a short reason.',
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string' },
        explicit_human_request: {
          type: 'boolean',
          description:
            'true if the customer directly asked to talk to a person/agent.',
        },
      },
      required: ['reason'],
    },
  },
];

async function callAnthropic(messages) {
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
        max_tokens: 700,
        system: SYSTEM_PROMPT,
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

/**
 * Generate a reply for the customer.
 * @param {{history: Array<{role:string, content:any}>, userText: string}} args
 * @returns {Promise<{text:string, wantsHuman:boolean, unableCount:number, reason:string|null}>}
 */
export async function generateReply({ history, userText }) {
  const messages = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: userText },
  ];

  let wantsHuman = false;
  let unableCount = 0;
  let reason = null;

  for (let i = 0; i < 5; i++) {
    const res = await callAnthropic(messages);

    if (res.stop_reason === 'tool_use') {
      const toolResults = [];
      for (const block of res.content) {
        if (block.type !== 'tool_use') continue;
        if (block.name === 'lookup_product') {
          let summary;
          try {
            summary = await searchProducts(String(block.input?.query || ''));
          } catch (err) {
            summary = `Product lookup is temporarily unavailable (${err.message}). Do not invent details; offer to check and follow up.`;
          }
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: summary,
          });
        } else if (block.name === 'unable_to_help') {
          unableCount++;
          reason = block.input?.reason || 'unresolved';
          if (block.input?.explicit_human_request) wantsHuman = true;
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content:
              'Acknowledged — a human specialist will follow up. Now write a warm, brief message telling the customer you are connecting them with a GemHub specialist and share care@gemhub.in and the Sector 45 Gurugram showroom.',
          });
        }
      }
      messages.push({ role: 'assistant', content: res.content });
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // Terminal response.
    const text = (res.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    return {
      text:
        text ||
        'Sorry, I didn’t quite catch that 🙏 Could you tell me a little more about what you’re looking for?',
      wantsHuman,
      unableCount,
      reason,
    };
  }

  // Safety valve if the tool loop runs away.
  return {
    text:
      'Let me connect you with a GemHub specialist who can help further. You can also reach us at care@gemhub.in or visit our Sector 45, Gurugram showroom (10 AM–7 PM). 💎',
    wantsHuman: true,
    unableCount: unableCount || 1,
    reason: reason || 'max_tool_turns',
  };
}
