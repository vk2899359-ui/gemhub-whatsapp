// Verifies that every external integration the app depends on is reachable
// and correctly configured, using the SAME environment variables the
// deployment uses.
//
// Run it with the project's env loaded. Easiest:
//   vercel env pull .env.local      # writes a gitignored .env.local
//   node scripts/verify-deploy.js
//
// Or provide the vars inline / via your own .env. Nothing here writes secrets
// to disk. Prints PASS/FAIL per check and exits non-zero if any fail.
import fs from 'node:fs';
import path from 'node:path';

// ── Minimal .env loader (no external dependency) ─────────────────────
function loadEnvFile() {
  for (const file of ['.env.local', '.env']) {
    const p = path.resolve(process.cwd(), file);
    if (!fs.existsSync(p)) continue;
    const txt = fs.readFileSync(p, 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let [, k, v] = m;
      v = v.trim().replace(/^["']|["']$/g, '');
      if (!(k in process.env)) process.env[k] = v;
    }
    return file;
  }
  return null;
}

const env = process.env;
const loaded = loadEnvFile();

const SHOPIFY_STORE = env.SHOPIFY_STORE || 'vbvidr-u9.myshopify.com';
const SHOPIFY_API_VERSION = env.SHOPIFY_API_VERSION || '2024-10';
const GRAPH_API_VERSION = env.GRAPH_API_VERSION || 'v21.0';
const PHONE_NUMBER_ID = env.PHONE_NUMBER_ID || '1186838137853897';
const ANTHROPIC_MODEL = env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

function need(name) {
  const v = env[name];
  if (!v) throw new Error(`missing env var ${name}`);
  return v;
}

// ── Checks ───────────────────────────────────────────────────────────

async function checkRedis() {
  const url = need('UPSTASH_REDIS_REST_URL');
  const token = need('UPSTASH_REDIS_REST_TOKEN');
  const { Redis } = await import('@upstash/redis');
  const r = new Redis({ url, token });
  const key = `verify:deploy:${Date.now()}`;
  await r.set(key, 'ok', { ex: 30 });
  const val = await r.get(key);
  await r.del(key);
  if (val !== 'ok') throw new Error(`round-trip mismatch (got ${JSON.stringify(val)})`);
  return 'set/get/del round-trip OK';
}

async function checkShopify() {
  // Dev Dashboard app: mint a token via client_credentials, then use it.
  const clientId = env.SHOPIFY_API_KEY || env.SHOPIFY_CLIENT_ID;
  const clientSecret = need('SHOPIFY_API_SECRET');
  if (!clientId) throw new Error('missing env var SHOPIFY_API_KEY');

  const tokenRes = await fetch(
    `https://${SHOPIFY_STORE}/admin/oauth/access_token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    }
  );
  const tokenBody = await tokenRes.text();
  if (!tokenRes.ok) {
    throw new Error(`token exchange HTTP ${tokenRes.status}: ${tokenBody.slice(0, 300)}`);
  }
  const token = JSON.parse(tokenBody).access_token;
  if (!token) throw new Error(`no access_token in response: ${tokenBody.slice(0, 200)}`);

  const res = await fetch(
    `https://${SHOPIFY_STORE}/admin/api/${SHOPIFY_API_VERSION}/shop.json`,
    { headers: { 'X-Shopify-Access-Token': token } }
  );
  const body = await res.text();
  if (!res.ok) throw new Error(`shop.json HTTP ${res.status}: ${body.slice(0, 300)}`);
  const shop = JSON.parse(body).shop;
  return `shop "${shop.name}" (${shop.myshopify_domain}), plan ${shop.plan_name}, token minted OK`;
}

async function checkMeta() {
  const token = need('META_TOKEN');
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${PHONE_NUMBER_ID}?fields=verified_name,display_phone_number,quality_rating,code_verification_status`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
  const j = JSON.parse(body);
  return `number ${j.display_phone_number || '?'} "${j.verified_name || '?'}", quality ${j.quality_rating || '?'}`;
}

async function checkAnthropic() {
  const key = need('ANTHROPIC_API_KEY');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Reply with the single word: OK' }],
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
  const j = JSON.parse(body);
  const text = (j.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  return `model ${ANTHROPIC_MODEL} replied "${text}"`;
}

// ── Runner ───────────────────────────────────────────────────────────

const CHECKS = [
  ['Upstash Redis', checkRedis],
  ['Shopify Admin API', checkShopify],
  ['Meta Graph API', checkMeta],
  ['Anthropic API', checkAnthropic],
];

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

async function main() {
  console.log('GemHub WhatsApp — deployment verification');
  console.log(loaded ? `${DIM}(loaded env from ${loaded})${RESET}` : `${DIM}(using process.env only)${RESET}`);
  console.log('');

  let failures = 0;
  for (const [name, fn] of CHECKS) {
    process.stdout.write(`  ${name.padEnd(20)} `);
    try {
      const detail = await fn();
      console.log(`${GREEN}PASS${RESET}  ${DIM}${detail}${RESET}`);
    } catch (err) {
      failures++;
      console.log(`${RED}FAIL${RESET}  ${err.message}`);
    }
  }

  console.log('');
  if (failures === 0) {
    console.log(`${GREEN}All checks passed.${RESET}`);
  } else {
    console.log(`${RED}${failures} check(s) failed.${RESET}`);
  }
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error('verifier crashed:', err);
  process.exitCode = 1;
});
