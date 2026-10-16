// Booking area. Public URLs (unchanged):
//   POST /api/bookings/request            -> bookings-request
//   POST /api/bookings/respond            -> bookings-respond
//   POST /api/bookings/cancel             -> bookings-cancel
//   POST /api/bookings/completion         -> bookings-completion
//   POST /api/bookings/otp                -> bookings-otp
//   POST /api/bookings/disputes           -> bookings-disputes
//   POST /api/bookings/dispute-evidence   -> bookings-dispute-evidence
//   GET  /api/my-bookings                 -> bookings-mine
//   GET  /api/bookings/:id                -> bookings-detail
import { createHmac, randomInt } from 'node:crypto';
import { requireUser } from '../supabase.js';
import { methodNotAllowed, readBody, sendError } from '../http.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function requestBooking(req, res) {
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

export async function respondToBooking(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const { userClient } = await requireUser(req);
    const body = await readBody(req);
    if (!isUuid(body.bookingId) || typeof body.accept !== 'boolean') return res.status(400).json({ error: 'Booking and decision are required.' });
    const { data, error } = await userClient.rpc('respond_to_booking_request', { p_booking_id: body.bookingId, p_accept: body.accept, p_reason: String(body.reason || '').slice(0, 1000) });
    if (error) throw error;
    return res.status(200).json(data);
  } catch (error) { return sendError(res, error); }
}

export async function cancelBooking(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const { userClient } = await requireUser(req);
    const body = await readBody(req);
    if (!isUuid(body.bookingId)) return res.status(400).json({ error: 'Booking id is required.' });
    const { data, error } = await userClient.rpc('cancel_unpaid_booking', { p_booking_id: body.bookingId, p_reason: String(body.reason || '').slice(0, 1000) });
    if (error) throw error;
    return res.status(200).json(data);
  } catch (error) { return sendError(res, error, 'Booking cannot be cancelled through this flow.'); }
}

export async function bookingCompletion(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const { userClient } = await requireUser(req);
    const body = await readBody(req);
    if (!isUuid(body.bookingId)) return res.status(400).json({ error: 'Booking id is required.' });
    const procedures = { host_submit: 'host_submit_completion', creator_confirm: 'creator_confirm_completion' };
    const procedure = procedures[body.action];
    if (!procedure) return res.status(400).json({ error: 'Choose a valid completion action.' });
    const { data, error } = await userClient.rpc(procedure, { p_booking_id: body.bookingId });
    if (error) throw error;
    return res.status(200).json(data);
  } catch (error) { return sendError(res, error, 'Booking completion could not be updated.'); }
}

export async function bookingOtp(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const key = process.env.OTP_HMAC_SECRET;
  if (!key || Buffer.byteLength(key) < 32) return res.status(503).json({ error: 'Secure check-in codes are not configured yet.' });
  try {
    const { userClient } = await requireUser(req);
    const body = await readBody(req);
    if (!isUuid(body.bookingId)) return res.status(400).json({ error: 'Booking id is required.' });
    if (body.action === 'issue') {
      const ttl = Number.parseInt(process.env.OTP_TTL_MINUTES || '', 10);
      if (!Number.isInteger(ttl) || ttl < 1 || ttl > 360) return res.status(503).json({ error: 'The check-in window has not been configured.' });
      const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
      const expiresAt = new Date(Date.now() + ttl * 60_000).toISOString();
      const hash = hashCode(key, body.bookingId, code);
      const { data, error } = await userClient.rpc('issue_booking_otp', { p_booking_id: body.bookingId, p_code_hash: hash, p_expires_at: expiresAt });
      if (error) throw error;
      res.setHeader('Cache-Control', 'no-store, private');
      res.setHeader('Pragma', 'no-cache');
      return res.status(200).json({ code, expires_at: data.expires_at, shown_once: true });
    }
    if (body.action === 'verify') {
      const code = String(body.code || '');
      if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Enter the six-digit check-in code.' });
      const hash = hashCode(key, body.bookingId, code);
      const { data, error } = await userClient.rpc('verify_booking_otp', { p_booking_id: body.bookingId, p_candidate_hash: hash });
      if (error) throw error;
      res.setHeader('Cache-Control', 'no-store, private');
      return res.status(200).json({ verified: Boolean(data?.verified), reason: data?.reason || null, booking_status: data?.booking_status || null });
    }
    return res.status(400).json({ error: 'Choose a valid OTP action.' });
  } catch (error) { return sendError(res, error, 'Check-in code request failed.'); }
}

export async function openDispute(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const { userClient } = await requireUser(req);
    const body = await readBody(req);
    if (!isUuid(body.bookingId) || !disputeTypes.has(String(body.type))) return res.status(400).json({ error: 'Choose a booking and a valid dispute type.' });
    const description = String(body.description || '').trim();
    if (description.length < 10 || description.length > 10000) return res.status(400).json({ error: 'Add a description between 10 and 10,000 characters.' });
    const { data, error } = await userClient.rpc('open_booking_dispute', { p_booking_id: body.bookingId, p_dispute_type: body.type, p_description: description });
    if (error) throw error;
    return res.status(201).json(data);
  } catch (error) { return sendError(res, error, 'Dispute could not be opened.'); }
}

export async function registerDisputeEvidence(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const { userClient } = await requireUser(req);
    const body = await readBody(req);
    if (!isUuid(body.disputeId) || typeof body.storagePath !== 'string' || body.storagePath.length > 700) return res.status(400).json({ error: 'Dispute and uploaded evidence are required.' });
    const { data, error } = await userClient.rpc('register_dispute_evidence', { p_dispute_id: body.disputeId, p_storage_path: body.storagePath });
    if (error) throw error;
    return res.status(201).json(data);
  } catch (error) { return sendError(res, error, 'Evidence could not be registered.'); }
}

export async function bookingDetail(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const { userClient } = await requireUser(req);
    const id = String(req.query.id || '');
    if (!isUuid(id)) return res.status(400).json({ error: 'A valid booking id is required.' });
    const { data: row, error } = await userClient.from('bookings').select(safeColumns).eq('id', id).maybeSingle();
    if (error) throw error;
    if (!row) return res.status(404).json({ error: 'Booking was not found for this account.' });
    let privateDetails = null;
    if (row.payment_status === 'paid' && privateStatuses.has(row.booking_status)) {
      const result = await userClient.rpc('get_booking_private_details', { p_booking_id: id });
      if (result.error) throw result.error;
      privateDetails = result.data;
    }
    res.setHeader('Cache-Control', 'no-store, private');
    return res.status(200).json({ booking: { ...row, ...(privateDetails || {}), listing: privateDetails?.listing || { title: row.listing_title_snapshot, city: row.listing_city_snapshot, neighbourhood: row.listing_neighbourhood_snapshot } }, privateDetailsAvailable: Boolean(privateDetails) });
  } catch (error) { return sendError(res, error, 'Booking details could not be loaded.'); }
}

export async function myBookings(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const { userClient, user } = await requireUser(req);
    const { data, error } = await userClient.from('bookings').select('id,public_code,listing_title_snapshot,starts_at,ends_at,booking_status,payment_status,payout_status').or(`creator_id.eq.${user.id},host_id.eq.${user.id}`).order('starts_at', { ascending: false }).limit(100);
    if (error) throw error;
    res.setHeader('Cache-Control', 'no-store, private');
    return res.status(200).json({ bookings: data || [] });
  } catch (error) { return sendError(res, error, 'Booking records could not be loaded.'); }
}

const disputeTypes = new Set(['host_no_show', 'listing_mismatch', 'safety_issue', 'property_damage', 'payment_issue', 'session_overrun', 'other']);
const safeColumns = 'id,public_code,listing_id,listing_title_snapshot,listing_city_snapshot,listing_neighbourhood_snapshot,starts_at,ends_at,crew_size,production_type,booking_status,payment_status,payout_status,total_amount_kobo,creator_fee_kobo,host_share_kobo_snapshot';
const privateStatuses = new Set(['confirmed', 'checked_in', 'completion_pending', 'completed', 'disputed']);

function isValidDate(value) { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function hashCode(secret, bookingId, code) { return createHmac('sha256', secret).update(`${bookingId}:${code}`).digest('hex'); }
function isUuid(value) { return uuidPattern.test(String(value || '')); }

export const bookingRoutes = {
  defaultRoute: null,
  routes: {
    'bookings-request': requestBooking,
    'bookings-respond': respondToBooking,
    'bookings-cancel': cancelBooking,
    'bookings-completion': bookingCompletion,
    'bookings-otp': bookingOtp,
    'bookings-disputes': openDispute,
    'bookings-dispute-evidence': registerDisputeEvidence,
    'bookings-detail': bookingDetail,
    'bookings-mine': myBookings,
  },
};
