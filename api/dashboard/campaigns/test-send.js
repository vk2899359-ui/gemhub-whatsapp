// Sends the mandatory test message to the owner's number before a campaign
// over the size threshold can launch. Uses the exact same component-building
// logic as the real send (lib/campaign-sender.js) so what's approved is
// what actually goes out.
import { requireAuth } from '../../../lib/dashboardAuth.js';
import { normalizePhone } from '../../../lib/phone.js';
import { sendTemplate } from '../../../lib/whatsapp.js';
import { buildSendComponents } from '../../../lib/campaign-sender.js';
import { getCampaign, getQueueSlice, getRecipientStatus, updateCampaign, STATUSES } from '../../../lib/campaigns.js';
import { CONFIG } from '../../../lib/env.js';
import { logSystem } from '../../../lib/log.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  if (!requireAuth(req, res)) return;

  const campaignId = req.body?.campaignId;
  const campaign = await getCampaign(campaignId);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const testPhone = normalizePhone(CONFIG.CAMPAIGNS.ALERT_PHONE);
  const [sampleId] = await getQueueSlice(campaignId, 0, 0);
  const sampleLead = sampleId ? await getRecipientStatus(campaignId, sampleId) : { name: 'Test', phone: testPhone, extra: {} };

  const components = buildSendComponents(campaign, sampleLead);
  try {
    await sendTemplate(testPhone, { name: campaign.templateName, language: campaign.templateLanguage, components });
  } catch (err) {
    return res.status(502).json({ error: `Test send failed: ${err.message}` });
  }

  await updateCampaign(campaignId, { status: STATUSES.AWAITING_APPROVAL });
  await logSystem({ event: 'campaign_test_sent', campaignId, testPhone });

  return res.status(200).json({ ok: true, sentTo: testPhone, status: STATUSES.AWAITING_APPROVAL });
}
