import { requireRole, requireUser } from '../../_lib/supabase.js';
import { methodNotAllowed, readBody, sendError } from '../../_lib/http.js';

const decisions = new Set(['approve','request_changes','reject','suspend']);
export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const { userClient, user } = await requireUser(req);
    await requireRole(userClient, user.id, 'admin');
    const body = await readBody(req);
    if (!isUuid(body.hostUserId) || !decisions.has(String(body.decision))) return res.status(400).json({ error: 'Host and review decision are required.' });
    const reason = String(body.reason || '').trim();
    if (reason.length < 5 || reason.length > 2000) return res.status(400).json({ error: 'An audit reason between 5 and 2,000 characters is required.' });
    const { data, error } = await userClient.rpc('admin_review_host', { p_host_user_id: body.hostUserId, p_decision: body.decision, p_reason: reason });
    if (error) throw error;
    return res.status(200).json(data);
  } catch (error) { return sendError(res, error, 'Host review could not be completed.'); }
}
function isUuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '')); }
