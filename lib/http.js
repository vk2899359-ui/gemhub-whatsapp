// HTTP helpers: raw body reader (for HMAC) and a fetch wrapper with
// exponential backoff + jitter.

/**
 * Read the raw request body as a Buffer.
 * Must be called BEFORE touching req.body so the stream isn't consumed.
 */
export async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * fetch with retries. Retries on network errors and on 429 / 5xx
 * responses. Uses exponential backoff with jitter.
 *
 * @param {string} url
 * @param {RequestInit} options
 * @param {{attempts?:number, baseDelayMs?:number, label?:string}} [opts]
 * @returns {Promise<Response>} the final Response (may be non-ok if all
 *          attempts returned a retryable status)
 */
export async function fetchWithRetry(url, options = {}, opts = {}) {
  const attempts = opts.attempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const label = opts.label || url;

  let lastError = null;
  let lastResponse = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, options);
      lastResponse = res;
      if (res.ok) return res;

      // Retry on rate limit / server errors only.
      if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
        if (attempt < attempts) {
          const delay = backoff(baseDelayMs, attempt, res);
          console.warn(
            `[fetchWithRetry] ${label} -> ${res.status}, retry ${attempt}/${attempts} in ${delay}ms`
          );
          await sleep(delay);
          continue;
        }
      }
      // Non-retryable status: return as-is for caller to inspect.
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        const delay = backoff(baseDelayMs, attempt);
        console.warn(
          `[fetchWithRetry] ${label} threw "${err.message}", retry ${attempt}/${attempts} in ${delay}ms`
        );
        await sleep(delay);
        continue;
      }
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError || new Error(`fetchWithRetry failed: ${label}`);
}

function backoff(base, attempt, res) {
  // Honour Retry-After when present.
  if (res) {
    const ra = res.headers.get('retry-after');
    if (ra) {
      const secs = Number(ra);
      if (!Number.isNaN(secs)) return Math.min(secs * 1000, 15000);
    }
  }
  const exp = base * Math.pow(2, attempt - 1);
  const jitter = Math.floor(Math.random() * base);
  return Math.min(exp + jitter, 15000);
}
