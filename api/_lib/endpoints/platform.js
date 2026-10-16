// Public platform-read area. Public URLs (unchanged):
//   GET /api/amenities              -> platform-amenities
//   GET /api/availability           -> platform-availability
//   GET /api/reviews                -> platform-reviews
//   GET /api/settings               -> platform-settings
import { getAnonymousClient } from '../supabase.js';
import { methodNotAllowed, sendError } from '../http.js';

export async function amenities(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const { data, error } = await getAnonymousClient().from('amenities').select('id,slug,name').eq('is_active', true).order('name');
    if (error) throw error;
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ amenities: data || [] });
  } catch (error) { return sendError(res, error, 'Amenities could not be loaded.'); }
}

export async function availability(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const listingId = String(req.query.listingId || '');
  const date = String(req.query.date || '');
  if (!isUuid(listingId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'A valid listing and date are required.' });
  try {
    const start = new Date(`${date}T00:00:00+01:00`);
    if (!Number.isFinite(start.valueOf())) return res.status(400).json({ error: 'Choose a valid calendar date.' });
    const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(start);
    if (localDate !== date) return res.status(400).json({ error: 'Choose a valid calendar date.' });
    const end = new Date(start.valueOf() + 24 * 60 * 60 * 1000);
    const db = getAnonymousClient();
    const [rules, busy, exceptions] = await Promise.all([
      db.from('public_availability').select('weekday,opens_at,closes_at,timezone').eq('listing_id', listingId),
      db.from('public_busy_slots').select('starts_at,ends_at').eq('listing_id', listingId).lt('starts_at', end.toISOString()).gt('ends_at', start.toISOString()),
      db.from('public_availability_exceptions').select('starts_at,ends_at').eq('listing_id', listingId).lt('starts_at', end.toISOString()).gt('ends_at', start.toISOString()),
    ]);
    for (const result of [rules, busy, exceptions]) if (result.error) throw result.error;
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Lagos', weekday: 'short' }).format(start);
    const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
    return res.status(200).json({
      date, weekday: dayMap[weekday], timezone: 'Africa/Lagos',
      openingHours: (rules.data || []).filter((item) => Number(item.weekday) === dayMap[weekday]),
      busySlots: busy.data || [], blockedIntervals: exceptions.data || [],
    });
  } catch (error) { return sendError(res, error, 'Availability could not be loaded.'); }
}

export async function reviews(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const listingId = String(req.query.listingId || '');
  if (!isUuid(listingId)) return res.status(400).json({ error: 'A valid listing is required.' });
  try {
    const { data, error } = await getAnonymousClient().from('reviews').select('rating,body,created_at').eq('listing_id', listingId).eq('moderation_status', 'published').order('created_at', { ascending: false }).limit(30);
    if (error) throw error;
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ reviews: data || [] });
  } catch (error) { return sendError(res, error, 'Reviews could not be loaded.'); }
}

export async function settings(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const { data, error } = await getAnonymousClient().from('public_platform_settings').select('*').maybeSingle();
    if (error) throw error;
    if (!data) return res.status(503).json({ error: 'Platform settings are not available.' });
    const paymentRuntimeReady = process.env.PAYMENT_ENABLED === 'true' && process.env.PAYMENT_PROVIDER === 'paystack' && Boolean(process.env.PAYSTACK_SECRET_KEY) && Boolean(process.env.PAYMENT_RETURN_URL);
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
    return res.status(200).json({
      bookingEnabled: Boolean(data.booking_enabled && data.cancellation_policy_approved),
      paymentEnabled: Boolean(data.payment_enabled && data.booking_enabled && data.cancellation_policy_approved && paymentRuntimeReady),
      cancellationPolicyApproved: Boolean(data.cancellation_policy_approved),
      cancellationPolicyVersion: data.cancellation_policy_version,
      cancellationPolicyText: data.cancellation_policy_text,
      requestExpiryMinutes: data.request_expiry_minutes,
      paymentWindowMinutes: data.payment_window_minutes,
      otpTtlMinutes: data.otp_ttl_minutes,
      otpWindowBeforeMinutes: data.otp_window_before_minutes,
      otpWindowAfterMinutes: data.otp_window_after_minutes,
      payoutDelayHours: data.payout_delay_hours,
      commissionBps: Number(data.commission_bps),
      creatorFeeBps: data.creator_fee_approved ? Number(data.creator_fee_bps) : 0,
      creatorFeeApproved: Boolean(data.creator_fee_approved),
    });
  } catch (error) { return sendError(res, error, 'Platform settings could not be loaded.'); }
}

function isUuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '')); }

export const platformRoutes = {
  defaultRoute: null,
  routes: {
    'platform-amenities': amenities,
    'platform-availability': availability,
    'platform-reviews': reviews,
    'platform-settings': settings,
  },
};
