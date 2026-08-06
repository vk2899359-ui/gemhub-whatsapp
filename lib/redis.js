// Upstash Redis (REST) client. Reads UPSTASH_REDIS_REST_URL and
// UPSTASH_REDIS_REST_TOKEN from the environment automatically.
import { Redis } from '@upstash/redis';

let _redis = null;

export function redis() {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      'Missing UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN'
    );
  }
  _redis = new Redis({ url, token });
  return _redis;
}
