import { requireAuth } from '../../lib/dashboardAuth.js';
import { getConversation, markConversationRead } from '../../lib/conversations.js';
import { normalizePhone } from '../../lib/phone.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  if (!requireAuth(req, res)) return;

  const phone = normalizePhone(req.query.phone);
  if (!phone) return res.status(400).json({ error: 'Missing or invalid phone' });

  try {
    const conversation = await getConversation(phone);
    // Viewing a thread marks it read (standard chat-app behaviour).
    await markConversationRead(phone);
    conversation.unreadCount = 0;
    return res.status(200).json({ conversation });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
