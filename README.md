# GemHub WhatsApp Automation

WhatsApp Cloud API automation for the GemHub Shopify jewellery store
(`vbvidr-u9.myshopify.com`). Runs as Vercel serverless functions with
Upstash Redis for state and Claude for AI replies.

**Features**

- Abandoned-cart recovery (60 min + 24 h nudges, max 2 per checkout)
- COD order confirmation with CONFIRM / CANCEL buttons → tags & cancels in Shopify
- Order-paid confirmation & shipped-with-tracking messages
- AI sales consultant (Hindi / Hinglish / English) with live product lookup,
  interactive menus/product cards/booking, and human handover
- Human handover to the sales agent (Keshav) with lead-summary notifications
- A WhatsApp-Web-style CRM dashboard (`/dashboard`) — every conversation,
  manual replies, bot on/off, search/filter, lead stage tracking
- 24-hour service window handling, retries with backoff, webhook de-dup,
  full send/receive logging in Redis

---

## 1. File structure

```
.
├── api/
│   ├── webhook.js                 # WhatsApp: GET verify + POST receive
│   ├── shopify-webhook.js         # Shopify: HMAC-verified event receiver
│   ├── register-webhooks.js       # One-time Shopify webhook registration
│   ├── cron/
│   │   └── abandoned-cart.js      # Vercel cron, daily (+ campaign watchdog sweep)
│   ├── campaigns/
│   │   ├── process.js             # Self-chaining campaign tick (secret-protected)
│   │   └── zoho-sync.js           # Self-chaining Zoho Leads pull (secret-protected)
│   └── dashboard/
│       ├── index.js               # Conversations dashboard (self-contained HTML/CSS/JS)
│       ├── campaigns-page.js      # Campaign builder page (self-contained HTML/CSS/JS)
│       ├── login.js / logout.js   # Password auth (signed cookie)
│       ├── conversations.js       # GET list + search + filter
│       ├── thread.js              # GET one conversation's full thread
│       ├── send.js                # POST manual reply (auto-pauses bot)
│       ├── bot.js                 # POST bot on/off toggle
│       ├── leads/
│       │   ├── upload.js          # Chunked CSV lead upload
│       │   ├── meta.js            # Lead counts/sources/tags/lists for filters
│       │   ├── zoho-start.js      # Trigger the Zoho sync
│       │   └── zoho-status.js     # Poll Zoho sync progress
│       ├── campaigns/
│       │   ├── templates.js       # Live approved-template list (Meta API)
│       │   ├── media-upload.js    # Header image upload -> reusable media_id
│       │   ├── audience-preview.js# Resolve a filter to recipient count/sample
│       │   ├── create.js          # Validate template + snapshot recipient queue
│       │   ├── test-send.js       # Mandatory test send (>threshold campaigns)
│       │   ├── approve.js         # Explicit approval -> running
│       │   ├── launch.js          # Direct launch (<=threshold campaigns)
│       │   ├── list.js / detail.js/failures.js # Monitor + failure breakdown
│       │   ├── pause.js / resume.js            # Per-campaign control
│       │   └── killswitch.js      # Global kill switch
│       └── suppression/
│           ├── list.js            # GET suppression list + count
│           ├── add.js / remove.js # Manual suppression management
├── lib/
│   ├── env.js                     # Config + lazy secrets
│   ├── redis.js                   # Upstash client
│   ├── http.js                    # Raw body + fetch-with-backoff
│   ├── log.js                     # Flat Redis debug log (log:events)
│   ├── conversations.js           # CRM data layer — per-conversation threads
│   ├── dashboardAuth.js           # Dashboard password/session handling
│   ├── phone.js                   # Phone normalisation
│   ├── lang.js                    # Zero-latency language detection
│   ├── leadinfo.js                # Budget/occasion/objection heuristics
│   ├── state.js                   # Window, memory, dedup, handover flag
│   ├── stores.js                  # Checkout tracking + COD mapping
│   ├── whatsapp.js                # Cloud API send + inbound/outbound recording
│   ├── templates.js               # Template component builders
│   ├── shopify.js                 # Admin API + HMAC + registration
│   ├── shopify-token.js           # client_credentials token mint/cache
│   ├── claude.js                  # AI sales consultant (tool-use loop)
│   ├── handover.js                # Human handover to the sales agent
│   ├── leads.js                   # Lead storage + audience resolution
│   ├── campaigns.js               # Campaign CRUD, queue, guardrails
│   ├── campaign-sender.js         # The resumable, self-chaining sending engine
│   ├── optout.js                  # Opt-out detection + suppression
│   ├── meta.js                    # Template list / media upload / quality rating
│   ├── zoho.js                    # Zoho Leads API client
│   ├── zoho-token.js              # Zoho OAuth refresh-token exchange
│   └── handlers/
│       ├── inbound.js             # Inbound message routing
│       └── shopify-events.js      # Shopify topic → WhatsApp flow
├── package.json
├── vercel.json                    # Cron + /dashboard + /campaigns rewrites + settings
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
- `DASHBOARD_PASSWORD` — pick a strong, unique password for `/dashboard`

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

### 4.6 `gemhub_lead_handover` — Utility

Sent to the sales agent (Keshav) when a customer is handed over, **only if
his 24h WhatsApp window is closed** (no message from him in the last 24h).
If his window is open, the bot sends a richer free-form message instead
(full transcript, products shown, budget) — no template needed for that case.

**Body:**
```
🔔 New GemHub lead

Customer: {{1}}
WhatsApp: {{2}}
Interested in: {{3}}
Reason: {{4}}

Reply here to claim this chat — the bot will pause for this customer.
```
**Variables:** `{{1}}` customer name · `{{2}}` customer WhatsApp number · `{{3}}` short interest/topic · `{{4}}` handover reason
**Sample values:** `{{1}}=Priya Sharma` · `{{2}}=919876543210` · `{{3}}=Solitaire engagement ring` · `{{4}}=Asked to speak with a person`
**Buttons:** none (the agent replies or swipe-replies directly — see §5a below).

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
- **Handover**: a warm, language-matched handoff to the sales agent (Keshav) —
  see §5a below.

Button and list replies are handled **by their reply id** in the webhook
(`browse_jewellery`, `book_visit`, `slot:<time>`, `product:<id>`, …), never by
matching the tapped text.

**Ad-sourced conversations.** If the first message matches the Google Ads
starter ("Hi GemHub! I'm interested in your lab-grown diamond jewellery…"), the
conversation is tagged `adsrc:<phone>` in Redis and the consultant opens with a
qualifying question instead of a generic greeting.

### 5a. Human handover (`lib/handover.js`)

Handover to the sales agent — **Keshav, +91 85957 72402** (`SALES_AGENT_NAME` /
`SALES_AGENT_PHONE`) — triggers on any of:

1. Customer explicitly asks for a person ("talk to a human", "kisi se baat
   karao", …) — `HUMAN_REQUEST_RE`.
2. Customer asks for a number to call ("share your number", "number do", …) —
   `NUMBER_REQUEST_RE`.
3. The bot fails to resolve intent **3 times in a row** — existing
   `bumpIntentFailures` counter.
4. Something the bot genuinely can't do — bulk/wholesale order, complaint,
   payment issue/fraud (`BUSINESS_ESCALATION_RE` safety net), or a
   custom-quote-beyond-catalogue request the AI itself judges out of scope via
   its `unable_to_help` tool.

**On every trigger, all three things happen:**

1. **Customer message**, in their detected language (Hindi / Hinglish /
   English — a fast heuristic, not an AI call, so the handoff is instant):
   tells them Keshav will help and shares his number to call directly.
2. **Agent notification** to Keshav: free-form (rich — full recent transcript,
   products shown, budget mention if detected, reason) if his 24h window is
   open; the `gemhub_lead_handover` **template** (§4.6) otherwise.
3. **Redis handover flag** (`escalation:<phone>`, reusing the existing
   "is a human handling this" key) — the bot goes quiet for that customer.
   **TTL is a sliding 24h window**: every customer message received while
   handed over refreshes it, so it **auto-releases after 24h of no customer
   activity**. It's also tracked in a `handover:active` Redis set for
   "release all".

**Releasing a chat back to the bot** — Keshav has three ways, all handled by
`handleAgentInbound` (messages *from* his number never reach the AI/customer
flow):
- **Swipe-reply** to the lead notification — WhatsApp echoes the original
  message id (`context.id`), which is mapped back to the customer
  (`handover:msg:<wamid>`, 24h TTL). Most precise; works even with several
  leads open.
- **`release <number>`** — releases that specific customer.
- **`release all`** — releases every currently active handover.
- A bare **`done` / `resolved` / `ok`** releases the one active handover if
  there's exactly one; with several open it lists them and asks him to be
  specific.

### 5b. CRM dashboard (`/dashboard`)

A WhatsApp-Web-style dashboard for every conversation, served as a single
self-contained page (no build step) at **`/dashboard`** (aliases to
`/api/dashboard`). Password-gated via `DASHBOARD_PASSWORD` — a signed,
HttpOnly session cookie, no user accounts, with a Redis-backed rate limit on
login attempts (10 / 15 min per IP).

**Data model (`lib/conversations.js`).** The flat `log:events` debug log
(§ above) isn't structured enough to reconstruct a conversation, so every
message now ALSO gets written into a per-conversation record:
- `thread:<phone>` — a capped (300 messages, 90-day TTL) list, oldest → newest,
  with a stable shape per entry: direction, kind (text/image/buttons/list/
  button_reply/location/template/order_event/…), body, media URL + caption,
  buttons/sections, which button/row was tapped, timestamp.
- `conversations` — a sorted set (score = last activity) for instant
  most-recent-first listing without a full scan.
- `conv:meta:<phone>` — name, last-message preview, unread count, lead stage,
  detected budget/occasion, objection flag, has-order flag.
- **Bot on/off and ad-sourced are NOT duplicated here** — read live from the
  existing `escalation:<phone>` / `adsrc:<phone>` keys (§5a), so there's a
  single source of truth and the dashboard toggle IS the same mechanism as
  agent handover (flipping it off pauses the bot exactly like Keshav taking
  over; flipping it on releases it exactly like his release command).

**Recording is automatic, not scattered.** `lib/whatsapp.js`'s `callGraph` —
the one function every single send already goes through (AI replies, COD
templates, abandoned-cart nudges, dashboard manual replies, everything) —
records each successful send into the thread. Inbound messages are recorded
once at the top of `handleInboundMessage`. Nothing needed touching at each
individual call site, and nothing sent via any current or future flow can be
missed.

**Lead stage** (`greeted → qualified → shown_products → booked → purchased`)
is a monotonically-advancing heuristic, not a strict state machine: budget/
occasion mentions in inbound text advance to `qualified`, showing product
cards advances to `shown_products`, booking a slot advances to `booked`,
`orders/paid` advances to `purchased`. It never regresses. Objection language
("too expensive", "mehenga") sets a separate `hasObjection` flag rather than
changing stage. All heuristic — a hint for the dashboard, not a data-entry
replacement.

**Search & filters.** Typing a query first matches conversation name / phone /
last-message preview (cheap, bounded to the most recent 500 conversations —
this business's realistic scale). If that finds nothing, it falls back to
scanning full thread bodies — a deeper, user-initiated-only pass (never part
of the polling loop, so it doesn't burn Redis requests in the background).
Filter chips: **Unread**, **Handed over**, **Ad-sourced**, **Has order**.

**Manual replies auto-pause the bot** — sending from the dashboard sets the
same handover flag as §5a (reason `dashboard_reply`), so the bot goes quiet
for that customer until the **Bot ON/OFF** toggle is flipped back or the
sliding 24h auto-release kicks in. If the customer's 24h window is closed,
free-form send fails and the error surfaces in the reply box (no template
picker in this version — use WhatsApp Manager directly for that case).

**Live-ish updates via polling** (no WebSockets): the conversation list polls
every 8s, the open thread every 4s, both paused while the browser tab is
hidden (Page Visibility API) to avoid burning Upstash requests in the
background.

**Known limitation:** inbound media (photos, voice notes, etc. sent *by* the
customer) renders as a labelled placeholder bubble, not the actual image —
Meta's inbound media URLs are token-gated and expire quickly, which would need
a proxy endpoint to serve safely. Out of scope for this pass since customers
in this flow are not expected to send photos. Outbound product-card images
(the bot showing Shopify photos) are completely unaffected — those are public
CDN URLs and render normally.

**Reliability.** Every send/receive is logged to the Redis list `log:events`
(capped at 2000). Sends retry up to 3× with exponential backoff. Incoming
WhatsApp webhooks are de-duplicated by message id (`SET NX`). The WhatsApp
webhook always returns `200` (even on internal errors) so Meta never disables
it; Shopify webhooks return `401` on bad HMAC and `200` otherwise.

### 5c. Bulk campaigns (`/campaigns`)

A separate page (same auth, same visual language) for template-based bulk
sends to a lead list — CSV upload or live Zoho CRM sync, template picker
sourced live from Meta (never hardcoded), variable mapping with a live
preview, audience filtering, scheduling, and a resumable sending engine with
every guardrail from the spec built in and non-optional.

**The reliability problem, and how it's solved on Hobby.** There is no
always-on background worker on Vercel Hobby, and Hobby's own cron is capped
at once/day (already true for the abandoned-cart cron). A multi-hour bulk
send can't be driven by either of those alone, so the sender
(`lib/campaign-sender.js`) uses **self-chaining**: each "tick"
(`/api/campaigns/process`) processes a bounded chunk (~45s, safely under the
60s function limit) at the campaign's configured throttle, then fires a
fire-and-forget request at itself to continue. Layered on top:
- The dashboard also nudges progress (via `list.js`'s side effects) while a
  campaign is open.
- The daily cron sweeps for a "running" campaign that's gone quiet
  (`lastTickAt` stale >15 min) and re-kicks it — the backstop of last resort.
- A manual **Resume** button in the dashboard always works, since the sender
  is fully idempotent per recipient.

**Honest limitation:** if a self-chain link ever fails to fire (rare, but
possible) and nobody has the dashboard open, the daily-cron backstop means a
worst case of **up to a 24h stall** before it's automatically noticed and
restarted. For a campaign you want running unattended over many hours with
tighter guarantees, point a free external cron pinger (e.g. cron-job.org) at
`POST /api/campaigns/process` with header `x-campaign-secret: $CAMPAIGN_SECRET`
every 1–2 minutes — zero code change needed, this endpoint is already
designed to be safely called repeatedly and does nothing if there's no active
campaign.

**Resumability & dedup.** `campaign:<id>:queue` is an ordered, immutable list
of recipients snapshotted once at campaign creation. `campaign:<id>:recipient:
<phone>` is the single source of truth for whether that recipient has been
handled — the sender always checks this before sending, so a recipient can
never be double-messaged even if a tick is retried, a resume happens
mid-flight, or the cursor is ever wrong. First-attempt sends and backoff
retries run through two separate queues (primary + retry) so a handful of
slow retries can never stall the primary queue's forward progress.

**Guardrails, all enforced inside every tick, not just at launch:**
- **Kill switch** — a persistent Redis flag. While on, every tick for every
  campaign no-ops; turning it off resumes everything automatically on the
  next tick, no per-campaign action needed.
- **Quality rating** — checked (cached 5 min) before every batch. `YELLOW`
  pauses every running campaign and alerts `CAMPAIGN_ALERT_PHONE`; `RED` stops
  every running campaign immediately and alerts.
- **Global daily cap** (`CAMPAIGN_DAILY_CAP`, default 1000) — checked per
  tick across all campaigns combined, not per-campaign.
- **Cooldown** (`CAMPAIGN_DEFAULT_COOLDOWN_DAYS`, default 7) — a global
  per-phone key set on every successful campaign send; checked before every
  future campaign send, regardless of which campaign originally set it.
- **Suppression (opt-out)** — see below; checked before every send, forever.
- **Test-send gate** — enforced server-side (not just in the UI): any
  campaign over `CAMPAIGN_TEST_SEND_REQUIRED_OVER` recipients (default 100)
  can only launch via test-send → explicit approve; the direct-launch
  endpoint refuses oversized campaigns outright.
- **Rate-limit circuit breaker** — Meta error code 131056 (per-recipient
  spam-rate throttle) or a generic 429 stops sending for the *rest of that
  tick* immediately, rather than continuing to hammer into the same wall.

**Opt-out (mandatory, `lib/optout.js`).** Detected on every inbound message,
regardless of conversation state — English/Hindi/Hinglish, deliberately
tuned to avoid false negatives at the cost of occasional false positives
(a missed opt-out is the actually dangerous failure mode; a wrongly-detected
one just needs a manual removal from the dashboard's suppression list).
Adds to a permanent Redis suppression set, confirms to the customer in their
language, and does **not** disable the support bot — only future campaign
sends are suppressed.

**Variable mapping.** Each `{{n}}` in a template body maps to either static
text, the lead's name/phone, or a named CSV/Zoho column — resolved per
recipient at send time from a snapshot taken when the campaign was created
(so a later CSV re-import can't retroactively change an in-flight send).
Image headers are uploaded once (`POST /{phone_number_id}/media`) and the
resulting `media_id` is reused across the entire send.

**Zoho CRM live sync setup.** Optional — CSV import (including a native
Zoho export, zero setup) is fully sufficient without it. To enable the
dashboard's "Sync from Zoho" button:
1. Go to **api-console.zoho.com** → **Add Client** → **Self Client**.
2. Under **Generate Code**, enter scope `ZohoCRM.modules.leads.READ` and a
   short validity window (e.g. 10 minutes), then generate.
3. Immediately exchange that code for a refresh token (it's shown once):
   ```bash
   curl -X POST https://accounts.zoho.in/oauth/v2/token \
     -d "grant_type=authorization_code" \
     -d "client_id=YOUR_CLIENT_ID" \
     -d "client_secret=YOUR_CLIENT_SECRET" \
     -d "code=THE_GENERATED_CODE"
   ```
4. Set `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, and `ZOHO_REFRESH_TOKEN`
   (from the response's `refresh_token`) in Vercel, then redeploy.
5. If your Zoho org isn't on the India (`.in`) data center, also set
   `ZOHO_ACCOUNTS_BASE` / `ZOHO_API_BASE` to match (`.com`, `.eu`, etc).

The refresh token never expires on its own (Zoho self-clients are long-lived
by design) — `lib/zoho-token.js` mints and caches short-lived access tokens
from it automatically, mirroring how `lib/shopify-token.js` already handles
Shopify's OAuth.

**Analytics.** Sent/failed are counted at send time; delivered/read come from
WhatsApp status webhooks (idempotency-guarded — Meta can redeliver the same
status callback, so each transition is only counted once per recipient, via
`deliveredAt`/`readAt` markers). Replied and opted-out are counted the first
time that customer messages back, which also tags their CRM conversation
with the sourcing campaign (`conv:meta:<phone>.campaignSource`) so replies
show up as normal conversations in `/dashboard`, not a separate inbox.
Failure reasons are grouped on demand (campaign detail drill-down, not part
of continuous polling) since scanning every recipient is only cheap when
it's user-initiated rather than constant.

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
7. **Human handover:** from a *different* WhatsApp number than Keshav's,
   message the bot "I want to talk to a person" (or in Hindi/Hinglish) →
   confirm you get a language-matched reply with Keshav's number, and that
   Keshav receives a lead notification. Reply-to (swipe) that notification
   from Keshav's number → confirm you receive "✅ Released …" and the bot
   responds again on your next message.
8. **Dashboard:** open `/dashboard`, log in with `DASHBOARD_PASSWORD` → confirm
   the conversation from step 4 appears with a correct preview/timestamp →
   open it → confirm the full bubble thread renders (including any product
   cards/buttons) → flip **Bot OFF**, confirm `escalation:<phone>` appears in
   Redis and the bot stops replying on WhatsApp → send a manual reply from the
   dashboard → confirm it arrives on WhatsApp → flip **Bot ON** → confirm the
   bot resumes replying. Try the search box and each filter chip.
9. **Logs:** inspect `log:events` in Upstash for a full audit trail.
10. **Opt-out:** message the bot "STOP" from a test number → confirm a polite
    confirmation reply and a `suppression:optout` entry in Redis (and in
    `/campaigns` → Suppression tab). Confirm the bot still answers a NORMAL
    follow-up message afterward (opt-out suppresses campaigns, not support).
11. **Campaign, small (≤ threshold):** `/campaigns` → Leads → import a tiny
    CSV (a couple of your own test numbers) → New Campaign → pick a template
    → map variables → preview audience → **Launch now** → watch the
    Campaigns tab counters move → confirm the message arrives on WhatsApp →
    confirm a reply from that number shows up in `/dashboard` tagged with
    the campaign.
12. **Campaign, gated (> threshold):** create a campaign over
    `CAMPAIGN_TEST_SEND_REQUIRED_OVER` recipients → confirm **Launch now**
    is unavailable and only **Send test message** appears → confirm the test
    arrives at `CAMPAIGN_ALERT_PHONE` → **Approve & launch** → confirm it
    starts running only after that.
13. **Kill switch:** while a campaign is running, hit the kill switch →
    confirm sending stops within one tick → turn it off → confirm the
    campaign resumes on its own without touching the campaign itself.
14. **Resumability:** pause a running campaign, note the sent count, resume
    it → confirm no recipient already marked `sent` gets a duplicate message
    (check a few `campaign:<id>:recipient:<phone>` hashes in Redis).

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
