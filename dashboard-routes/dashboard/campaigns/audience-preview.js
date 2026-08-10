// Resolves an audience filter to a recipient count + small sample, without
// building a campaign. Used by the campaign builder to show "N recipients"
// before the user commits. Does NOT apply suppression/cooldown filtering
// here (that happens per-recipient at send time) — this is a raw audience
// size estimate against the lead store.
import { requireAuth } from '../../../lib/dashboardAuth.js';
import { resolveAudience } from '../../../lib/leads.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  if (!requireAuth(req, res)) return;

  const filter = req.body?.filter || {};
  try {
    const leads = await resolveAudience(filter);
    return res.status(200).json({
      count: leads.length,
      sample: leads.slice(0, 5).map((l) => ({ phone: l.phone, name: l.name, source: l.source, tags: l.tags })),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
