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
  _redis = new Redis({
    url,
    token,
    // @upstash/redis defaults this to true: concurrent commands issued in
    // the same tick get transparently auto-batched into one HTTP call.
    // Found live, with a real stack trace: it crashes
    // (TypeError: Cannot read properties of undefined (reading 'length'),
    // inside the SDK's own HGetAllCommand.deserialize) when a read and a
    // write race on the same key under concurrent load — exactly this
    // app's pattern (a self-chaining sync tick writing zoho:sync:state
    // while the dashboard concurrently polls it). This app's traffic
    // doesn't need the batching optimization; disabling it trades a little
    // throughput for not crashing.
    enableAutoPipelining: false,
  });
  return _redis;
}
