// Simple password-gated session for the CRM dashboard. No user accounts —
// one shared password (DASHBOARD_PASSWORD) gates a signed, HttpOnly cookie.
// The signature key IS the password itself (nobody who can forge a valid
// cookie could not already just log in), so no extra secret is needed.
import crypto from 'node:crypto';
import { secrets } from './env.js';
import { redis } from './redis.js';

const COOKIE_NAME = 'gemhub_dash';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_SEC = 15 * 60;

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payload) {
  return crypto.createHmac('sha256', secrets.DASHBOARD_PASSWORD).update(payload).digest('hex');
}

export function createSessionCookieValue() {
  const payload = b64url(JSON.stringify({ exp: Date.now() + SESSION_TTL_MS }));
  return `${payload}.${sign(payload)}`;
}

export function sessionCookieHeader(value, { clear = false } = {}) {
  const maxAge = clear ? 0 : Math.floor(SESSION_TTL_MS / 1000);
  const val = clear ? '' : value;
  const isProd = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
  return `${COOKIE_NAME}=${val}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isProd ? '; Secure' : ''}`;
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return false;
  const [payload, signature] = token.split('.');
  let expected;
  try {
    expected = sign(payload);
  } catch {
    return false; // DASHBOARD_PASSWORD not configured
  }
  const a = Buffer.from(signature || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof exp === 'number' && exp > Date.now();
  } catch {
    return false;
  }
}

export function isAuthenticated(req) {
  const cookies = parseCookies(req.headers.cookie);
  return verifyToken(cookies[COOKIE_NAME]);
}

/** Call at the top of every protected dashboard API route. Writes 401 and
 * returns false if unauthenticated; returns true otherwise. */
export function requireAuth(req, res) {
  if (isAuthenticated(req)) return true;
  res.status(401).json({ error: 'Unauthorized' });
  return false;
}

/** Constant-time password check against DASHBOARD_PASSWORD. */
export function checkPassword(candidate) {
  const expected = crypto.createHash('sha256').update(secrets.DASHBOARD_PASSWORD).digest();
  const got = crypto.createHash('sha256').update(String(candidate || '')).digest();
  return crypto.timingSafeEqual(got, expected);
}

/** Light brute-force guard: max attempts per IP per window. Never throws. */
export async function checkLoginRateLimit(req) {
  try {
    const ip = (req.headers['x-forwarded-for'] || 'unknown').toString().split(',')[0].trim();
    const key = `dash:login:attempts:${ip}`;
    const n = await redis().incr(key);
    if (n === 1) await redis().expire(key, RATE_LIMIT_WINDOW_SEC);
    return n <= RATE_LIMIT_MAX;
  } catch {
    return true; // fail open on Redis hiccup — don't lock owner out
  }
}
