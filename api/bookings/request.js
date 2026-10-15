import { requireUser } from '../_lib/supabase.js';
import { methodNotAllowed, readBody, sendError } from '../_lib/http.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const { userClient, user } = await requireUser(req);
    const body = await readBody(req);
    const { listingId, startsAt, endsAt, crewSize, productionType, notes, idempotencyKey } = body;
    if (!uuidPattern.test(String(listingId || ''))) return res.status(400).json({ error: 'A valid listing id is required.' });
    if (!uuidPattern.test(String(idempotencyKey || ''))) return res.status(400).json({ error: 'A valid idempotency key is required; retry with the same key if the request times out.' });
    if (!isValidDate(startsAt) || !isValidDate(endsAt) || Date.parse(startsAt) >= Date.parse(endsAt)) return res.status(400).json({ error: 'Choose a valid start and end time.' });
    const crew = Number(crewSize);
    if (!Number.isInteger(crew) || crew < 1 || crew > 500) return res.status(400).json({ error: 'Crew size must be a whole number between 1 and 500.' });
    if (typeof productionType !== 'string' || productionType.trim().length < 2 || productionType.length > 100) return res.status(400).json({ error: 'Choose a production type.' });
    const { data, error } = await userClient.rpc('request_booking_request', {
      p_listing_id: listingId,
      p_starts_at: new Date(startsAt).toISOString(),
      p_ends_at: new Date(endsAt).toISOString(),
      p_crew_size: crew,
      p_production_type: productionType.trim(),
      p_notes: typeof notes === 'string' ? notes.slice(0, 2000) : '',
      p_idempotency_key: idempotencyKey,
    });
    if (error) throw error;
    res.setHeader('Cache-Control', 'no-store');
    return res.status(201).json({ ...data, creatorId: user.id });
  } catch (error) {
    return sendError(res, error, 'Booking request could not be submitted.');
  }
}

function isValidDate(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
