import { requireUser } from '../_lib/supabase.js';
import { methodNotAllowed, readBody, sendError } from '../_lib/http.js';

const allowedTypes = new Set(['host_no_show', 'listing_mismatch', 'safety_issue', 'property_damage', 'payment_issue', 'session_overrun', 'other']);
export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const { userClient } = await requireUser(req);
    const body = await readBody(req);
    if (!isUuid(body.bookingId) || !allowedTypes.has(String(body.type))) return res.status(400).json({ error: 'Choose a booking and a valid dispute type.' });
    const description = String(body.description || '').trim();
    if (description.length < 10 || description.length > 10000) return res.status(400).json({ error: 'Add a description between 10 and 10,000 characters.' });
    const { data, error } = await userClient.rpc('open_booking_dispute', { p_booking_id: body.bookingId, p_dispute_type: body.type, p_description: description });
    if (error) throw error;
    return res.status(201).json(data);
  } catch (error) { return sendError(res, error, 'Dispute could not be opened.'); }
}
function isUuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '')); }
