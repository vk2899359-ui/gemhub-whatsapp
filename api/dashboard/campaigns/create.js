// Creates a draft campaign: validates the template against Meta's live
// approved list (never trusts client-supplied template structure), resolves
// the audience, and snapshots the recipient queue. Does NOT send anything —
// see test-send.js / approve.js / launch.js for that.
import { requireAuth } from '../../../lib/dashboardAuth.js';
import { listApprovedTemplates } from '../../../lib/meta.js';
import { resolveAudience } from '../../../lib/leads.js';
import { createCampaign, buildRecipientQueue, STATUSES } from '../../../lib/campaigns.js';
import { CONFIG } from '../../../lib/env.js';
import { logSystem } from '../../../lib/log.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  if (!requireAuth(req, res)) return;

  const { name, templateName, variableMapping, imageMediaId, audienceFilter, throttlePerSec, cooldownDays, scheduledAt } =
    req.body || {};

  if (!templateName) return res.status(400).json({ error: 'Missing templateName' });

  let templates;
  try {
    templates = await listApprovedTemplates();
  } catch (err) {
    return res.status(502).json({ error: `Could not verify template with Meta: ${err.message}` });
  }
  const template = templates.find((t) => t.name === templateName);
  if (!template) {
    return res.status(400).json({ error: `"${templateName}" is not an approved template` });
  }
  if (template.headerFormat === 'IMAGE' && !imageMediaId) {
    return res.status(400).json({ error: 'This template needs an image header — upload one first' });
  }

  let leads;
  try {
    leads = await resolveAudience(audienceFilter || {});
  } catch (err) {
    return res.status(500).json({ error: `Audience resolution failed: ${err.message}` });
  }
  if (!leads.length) {
    return res.status(400).json({ error: 'That audience filter matches zero leads' });
  }

  // Reconstruct the raw {type, format, text} shape buildSendComponents
  // expects, from the summary meta.js already gave us.
  const templateComponents = [
    template.headerFormat ? { type: 'HEADER', format: template.headerFormat } : null,
    { type: 'BODY', text: template.bodyText },
  ].filter(Boolean);

  const campaignId = await createCampaign({
    name: name || templateName,
    templateName,
    templateLanguage: template.language,
    templateComponents,
    variableMapping: variableMapping || {},
    imageMediaId: imageMediaId || null,
    audienceFilter: audienceFilter || {},
    throttlePerSec: throttlePerSec || CONFIG.CAMPAIGNS.DEFAULT_THROTTLE_PER_SEC,
    cooldownDays: cooldownDays || CONFIG.CAMPAIGNS.DEFAULT_COOLDOWN_DAYS,
    scheduledAt: scheduledAt || null,
  });

  const totalRecipients = await buildRecipientQueue(campaignId, leads);
  const requiresTestSend = totalRecipients > CONFIG.CAMPAIGNS.TEST_SEND_REQUIRED_OVER;

  await logSystem({ event: 'campaign_created', campaignId, templateName, totalRecipients });

  return res.status(200).json({
    ok: true,
    campaignId,
    totalRecipients,
    requiresTestSend,
    status: STATUSES.DRAFT,
  });
}
