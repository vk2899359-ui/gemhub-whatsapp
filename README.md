# GemHub WhatsApp Automation

WhatsApp Cloud API automation for the GemHub Shopify jewellery store
(`vbvidr-u9.myshopify.com`). Runs as Vercel serverless functions with
Upstash Redis for state and Claude for AI replies.

**Features**

- Abandoned-cart recovery (60 min + 24 h nudges, max 2 per checkout)
- COD order confirmation with CONFIRM / CANCEL buttons → tags & cancels in Shopify
- Order-paid confirmation & shipped-with-tracking messages
- AI sales assistant (Hindi / Hinglish / English) with live product lookup
- 24-hour service window handling, retries with backoff, webhook de-dup,
  full send/receive logging in Redis, human escalation

---

## 1. File structure

```
.
├── api/
│   ├── webhook.js                 # WhatsApp: GET verify + POST receive
│   ├── shopify-webhook.js         # Shopify: HMAC-verified event receiver
│   ├── register-webhooks.js       # One-time Shopify webhook registration
│   └── cron/
│       └── abandoned-cart.js      # Vercel cron, every 30 min
├── lib/
│   ├── env.js                     # Config + lazy secrets
│   ├── redis.js                   # Upstash client
│   ├── http.js                    # Raw body + fetch-with-backoff
│   ├── log.js                     # Redis event log
│   ├── phone.js                   # Phone normalisation
│   ├── state.js                   # Window, memory, dedup, escalation
│   ├── stores.js                  # Checkout tracking + COD mapping
│   ├── whatsapp.js                # Cloud API send (text/template)
│   ├── templates.js               # Template component builders
│   ├── shopify.js                 # Admin API + HMAC + registration
│   ├── claude.js                  # AI assistant (tool-use loop)
│   └── handlers/
│       ├── inbound.js             # Inbound message routing
│       └── shopify-events.js      # Shopify topic → WhatsApp flow
├── package.json
├── vercel.json                    # Cron config + function settings
├── .env.example
└── README.md
```

---

## 2. Prerequisites

- A **Vercel** account (the app deploys as serverless functions).
- An **Upstash Redis** database (REST enabled).
- A **Meta / WhatsApp Cloud API** app with a phone number
  (WABA `1747154966614614`, phone-number id `1186838137853897`).
- A **Shopify Dev Dashboard app** on `vbvidr-u9.myshopify.com` (same Shopify
  org as the store) with these scopes:
  `read_products`, `read_checkouts`, `read_customers`, `write_orders`,
  `read_fulfillments`, `read_inventory`. The Admin API token is minted at
  runtime via the OAuth **client_credentials** grant (24h token, auto-refreshed
  and cached in Redis) — set `SHOPIFY_API_KEY` (Client ID) and
  `SHOPIFY_API_SECRET` (Client secret, `shpss_…`). No static `shpat_` token
  needed; legacy static tokens still work if `SHOPIFY_TOKEN` is set.
- An **Anthropic API key**.

---

## 3. Deploy

### 3.1 Install & link

```bash
npm install
npm i -g vercel   # if you don't have the CLI
vercel link
```

### 3.2 Set environment variables

Add every variable from [`.env.example`](.env.example) in the Vercel project
(**Settings → Environment Variables**, all environments). Key ones:

- `PUBLIC_BASE_URL` — set this **after** the first deploy to your production
  URL (e.g. `https://gemhub-whatsapp.vercel.app`), then redeploy.
- `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`
- `META_TOKEN`, `VERIFY_TOKEN` (`gemhub2026`)
- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` (defaults to `claude-sonnet-4-6`)
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- `REGISTER_SECRET` — pick any strong random string
- `CRON_SECRET` — pick any strong random string (Vercel sends this to the cron
  endpoint automatically)

> Locally: `cp .env.example .env`, fill it in, and run `vercel dev`.

### 3.3 First deploy

```bash
vercel --prod
```

Copy the production URL into `PUBLIC_BASE_URL`, then redeploy once so the value
is available to the functions:

```bash
vercel --prod
```

### 3.4 Connect the WhatsApp webhook (Meta)

In **Meta App Dashboard → WhatsApp → Configuration → Webhook**:

- **Callback URL:** `https://<your-domain>/api/webhook`
- **Verify token:** `gemhub2026` (must equal `VERIFY_TOKEN`)
- Click **Verify and Save** (this hits the `GET` handshake).
- **Subscribe** to the **`messages`** field.

(Optional) To verify inbound payload signatures, set `META_APP_SECRET` to your
Meta app secret; the webhook then checks `X-Hub-Signature-256`.

### 3.5 Register the Shopify webhooks

Call the protected endpoint once (idempotent — safe to re-run):

```bash
curl "https://<your-domain>/api/register-webhooks?secret=<REGISTER_SECRET>"
```

It registers: `checkouts/create`, `checkouts/update`, `orders/create`,
`orders/paid`, `orders/cancelled`, `fulfillments/create` — all pointing at
`/api/shopify-webhook`.

### 3.6 Cron

`vercel.json` schedules `/api/cron/abandoned-cart`. On the **Hobby plan** crons
run at most **once per day**, so it's set to `0 5 * * *` (05:00 UTC ≈ 10:30 IST).
Vercel picks it up automatically on deploy; it authenticates with `CRON_SECRET`.
The nudge logic is frequency-independent — on **Pro** you can change the schedule
to `*/30 * * * *` for near-real-time nudges with no code change.

---

## 4. WhatsApp message templates to submit to Meta

Create these in **WhatsApp Manager → Message templates**. Names, languages,
variable order, and button payloads **must match exactly** (the code references
them by name). Language: **English (`en`)**. To add Hindi/Hinglish, create the
same template names in that language and set `DEFAULT_TEMPLATE_LANG`.

Variables are positional `{{1}}, {{2}}, …` in the order listed.

---

### 4.1 `abandoned_cart_1` — Marketing

First nudge, 60 minutes after an abandoned checkout.

**Body:**
```
Hi {{1}}, you left something sparkling behind at GemHub 💎

*{{2}}* is still in your cart. Complete your purchase now — free insured shipping across India.

{{3}}

Need help deciding? Just reply here. 💍
```
**Variables:** `{{1}}` first name · `{{2}}` product name · `{{3}}` recovery URL
**Sample:** `{{1}}=Priya` · `{{2}}=1ct Solitaire Ring` · `{{3}}=https://gemhub.in/...`

---

### 4.2 `abandoned_cart_2` — Marketing

Final nudge, 24 hours after the checkout.

**Body:**
```
Hi {{1}}, your GemHub cart is still waiting ⏳

*{{2}}* is IGI/GRA-certified and ready for you. Complete your order today and it's yours:

{{3}}

Questions? Reply here or visit our Sector 45, Gurugram showroom (10 AM–7 PM).
```
**Variables:** `{{1}}` first name · `{{2}}` product name · `{{3}}` recovery URL

---

### 4.3 `cod_confirmation` — Utility · with buttons

Sent on a new COD order. **Add two Quick-reply buttons.**

**Body:**
```
Namaste {{1}} 🙏

We received your Cash-on-Delivery order *{{2}}* at GemHub.

{{3}}
Order total: *{{4}}*

Please confirm so we can pack and dispatch it. Tap a button below.
```
**Variables:** `{{1}}` first name · `{{2}}` order number · `{{3}}` items summary · `{{4}}` total
**Buttons (Quick reply):**
- Button 1 text: `Confirm Order`  → the code sends payload **`CONFIRM`**
- Button 2 text: `Cancel Order`   → the code sends payload **`CANCEL`**

> Button *text* is cosmetic; the code matches the returned payload/id containing
> `CONFIRM` / `CANCEL`. Keep the two-button order the same (index 0 = confirm,
> index 1 = cancel).

---

### 4.4 `order_paid` — Utility

Sent on `orders/paid`.

**Body:**
```
Thank you {{1}}! 🎉

Your GemHub order *{{2}}* is confirmed and payment received ({{3}}). Our team is preparing your jewellery with care — you'll get a tracking link the moment it ships.

Need anything? Reply here or email care@gemhub.in
```
**Variables:** `{{1}}` first name · `{{2}}` order number · `{{3}}` total

---

### 4.5 `order_shipped` — Utility

Sent on `fulfillments/create`.

**Body:**
```
Great news {{1}}! 🚚

Your GemHub order *{{2}}* has shipped via {{3}}.
Tracking number: *{{4}}*
Track here: {{5}}

Free insured delivery, right to your door 💎
```
**Variables:** `{{1}}` first name · `{{2}}` order number · `{{3}}` courier · `{{4}}` tracking number · `{{5}}` tracking URL

---

## 5. How it behaves

**24-hour service window.** Inbound messages open the window (tracked in Redis).
AI replies are free-form (they happen right after a customer message, i.e. in
window). All proactive/business-initiated messages (cart, COD, paid, shipped)
use approved **templates**, so they work outside the window too.

**Abandoned cart.** `checkouts/create|update` are stored in Redis (7-day TTL)
and indexed in an active set. `orders/create` marks the matching checkout
recovered (via `checkout_id`/`checkout_token`) so no nudge is sent. The cron
sends nudge 1 at 60 min and nudge 2 at 24 h — max 2 per checkout — then drops it
from tracking. Checkouts without a phone number are skipped.

**COD.** On `orders/create` where the gateway is Cash on Delivery, the
`cod_confirmation` template is sent and a `phone → order` mapping is stored.
Customer taps **CONFIRM** → order tagged `cod-confirmed`. Taps **CANCEL** →
order tagged `cod-cancelled` and cancelled in Shopify.

**Tracking.** `orders/paid` → `order_paid`. `fulfillments/create` →
`order_shipped` with tracking number + URL.

**AI chat — the sales consultant.** Any inbound text that isn't a COD button
goes to Claude (`ANTHROPIC_MODEL`, default `claude-sonnet-4-6`) with the last 10
turns of context (24-h TTL). The system prompt (`lib/claude.js`) is a
world-class fine-jewellery sales consultant: it matches the customer's language
(Hindi / Hinglish / English), qualifies early (occasion, budget, recipient,
timeline), recommends 2–3 curated pieces with a reason each, anchors on value
(IGI/GRA certification, direct-factory pricing, CAD design, old-gold exchange,
free insured shipping), handles objections, and always ends with a next step.
It calls `lookup_products` for live data and never invents prices or stock.

**Interactive replies.** Instead of plain text, Claude composes each reply by
choosing a WhatsApp format via tools, rendered in `lib/handlers/inbound.js`:

- **Default menu** (buttons): Browse Jewellery · Book Showroom Visit · Custom Design
- **After showing products** (buttons): See More · Book a Visit · Talk to Expert
- **Product cards**: up to 4 real Shopify **image messages** with catalogue
  captions (name, price, IGI/GRA cert, metal) + a *View Product* link, then a
  pick-list. Uses native catalog `product`/`product_list` messages when the WABA
  has a connected catalogue and `WHATSAPP_USE_CATALOG=true`; otherwise images.
- **Location intent**: a location pin + a *Get Directions* CTA to Google Maps.
- **Booking intent**: a **list** of showroom time slots (10 AM–7 PM); tapping a
  slot confirms the visit and shares the location.
- **Escalation**: a warm handoff with the showroom number (WhatsApp free-form
  can't render a `tel:` button, so the number is surfaced as tap-to-call text).

Button and list replies are handled **by their reply id** in the webhook
(`browse_jewellery`, `book_visit`, `slot:<time>`, `product:<id>`, …), never by
matching the tapped text.

**Ad-sourced conversations.** If the first message matches the Google Ads
starter ("Hi GemHub! I'm interested in your lab-grown diamond jewellery…"), the
conversation is tagged `adsrc:<phone>` in Redis and the consultant opens with a
qualifying question instead of a generic greeting.

**Escalation** to a human happens if the customer asks for a person, for
bulk/corporate/complaint intents, or after 3 unresolved intents; it sets a Redis
flag and the bot then stays quiet so a human can take over.

**Reliability.** Every send/receive is logged to the Redis list `log:events`
(capped at 2000). Sends retry up to 3× with exponential backoff. Incoming
WhatsApp webhooks are de-duplicated by message id (`SET NX`). The WhatsApp
webhook always returns `200` (even on internal errors) so Meta never disables
it; Shopify webhooks return `401` on bad HMAC and `200` otherwise.

---

## 6. Testing checklist

1. **Meta verify:** `GET /api/webhook?hub.mode=subscribe&hub.verify_token=gemhub2026&hub.challenge=123`
   returns `123`.
2. **Shopify HMAC:** a `POST /api/shopify-webhook` with a wrong/missing
   `X-Shopify-Hmac-Sha256` returns `401`.
3. **Register webhooks:** run the `register-webhooks` curl; confirm all six
   report `created` or `already_exists`.
4. **Inbound AI:** message the WhatsApp number ("do you have solitaire rings?")
   and confirm a reply + a `conv:<phone>` key in Redis.
5. **COD:** place a test COD order → confirm the template with buttons →
   tap CONFIRM/CANCEL → check the order tags in Shopify.
6. **Abandoned cart:** create a checkout with a phone number, don't order, wait
   for the cron (or hit `/api/cron/abandoned-cart` with the `CRON_SECRET`
   bearer header) after 60 min.
7. **Logs:** inspect `log:events` in Upstash for a full audit trail.

---

## 7. Notes & assumptions

- `SHOPIFY_API_VERSION` defaults to `2024-10`; bump it as Shopify releases new
  versions.
- Abandoned-checkout listing uses the REST `checkouts.json` endpoint and needs
  `read_checkouts`.
- Phone numbers are normalised to E.164 digits; bare 10-digit Indian numbers get
  `91` prepended (`DEFAULT_COUNTRY_CODE`).
- The AI model id is whatever you set in `ANTHROPIC_MODEL`. If the configured id
  is ever rejected by the API, change this one env var — no code change needed.
