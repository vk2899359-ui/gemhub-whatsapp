// Vercel Cron: find tracked checkouts that are overdue for a nudge and
// haven't converted, and send the abandoned-cart templates.
//   - First nudge:  once the checkout is >= 60 min old with no order.
//   - Second nudge: once the checkout is >= 24 h old, still no order.
//   - Max 2 follow-ups per checkout. State tracked in Redis (7-day TTL).
//
// NOTE: On the Vercel Hobby plan crons run at most once per day, so this is
// scheduled daily (see vercel.json). The due-time logic below is
// frequency-independent — each run sends whatever nudges have come due since
// the last run. On a Pro plan you can tighten the schedule (e.g. */30 * * * *)
// for near-real-time nudges with no code change.
import { secrets } from '../../lib/env.js';
import {
  activeCheckoutIds,
  getCheckout,
  saveCheckout,
  deactivateCheckout,
} from '../../lib/stores.js';
import { sendTemplate } from '../../lib/whatsapp.js';
import { abandonedCart1, abandonedCart2 } from '../../lib/templates.js';
import { logSystem } from '../../lib/log.js';

const SECOND_NUDGE_AT_MS = 24 * 60 * 60 * 1000; // 24h after checkout creation

export default async function handler(req, res) {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const now = Date.now();
  const summary = { checked: 0, sent: 0, skipped: 0, dropped: 0, errors: 0 };

  let ids;
  try {
    ids = await activeCheckoutIds();
  } catch (err) {
    await logSystem({ event: 'cron_list_error', error: err.message });
    return res.status(500).json({ error: err.message });
  }

  for (const id of ids) {
    summary.checked++;
    try {
      const c = await getCheckout(id);

      // Vanished (TTL expired) or already recovered -> drop from tracking.
      if (!c || c.recovered) {
        await deactivateCheckout(id);
        summary.dropped++;
        continue;
      }

      // Can't message without a phone number.
      if (!c.phone) {
        await deactivateCheckout(id);
        summary.dropped++;
        continue;
      }

      // Already sent the maximum of 2 follow-ups.
      if (c.followups >= 2) {
        await deactivateCheckout(id);
        summary.dropped++;
        continue;
      }

      // Not due yet.
      if (now < c.nextDueAt) {
        summary.skipped++;
        continue;
      }

      const data = {
        name: c.name || 'there',
        product: c.product || 'your selection',
        recoveryUrl: c.recoveryUrl || 'https://gemhub.in',
      };

      const template = c.followups === 0 ? abandonedCart1(data) : abandonedCart2(data);
      await sendTemplate(c.phone, template);

      c.followups += 1;
      if (c.followups >= 2) {
        // Done after the final nudge.
        c.nextDueAt = Number.MAX_SAFE_INTEGER;
        await saveCheckout(c);
        await deactivateCheckout(id);
      } else {
        // Schedule the second nudge for 24h after checkout creation.
        c.nextDueAt = c.createdAt + SECOND_NUDGE_AT_MS;
        await saveCheckout(c);
      }

      summary.sent++;
      await logSystem({
        event: 'abandoned_cart_sent',
        checkoutId: id,
        followup: c.followups,
        phone: c.phone,
      });
    } catch (err) {
      summary.errors++;
      await logSystem({
        event: 'abandoned_cart_error',
        checkoutId: id,
        error: err.message,
      });
    }
  }

  await logSystem({ event: 'cron_run', ...summary });
  return res.status(200).json({ ok: true, ...summary });
}

// Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is
// configured. Also accept Vercel's internal cron header. If no secret is set,
// allow (useful for local/manual runs) but log a warning.
function isAuthorized(req) {
  const secret = secrets.CRON_SECRET;
  if (!secret) return true;
  const auth = req.headers['authorization'] || '';
  if (auth === `Bearer ${secret}`) return true;
  if (req.headers['x-vercel-cron']) return true;
  return false;
}
