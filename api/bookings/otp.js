import { createHmac, randomInt } from 'node:crypto';
import { requireUser } from '../_lib/supabase.js';
import { methodNotAllowed, readBody, sendError } from '../_lib/http.js';

export default async function handler(req, res) {
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

function hashCode(secret, bookingId, code) {
  return createHmac('sha256', secret).update(`${bookingId}:${code}`).digest('hex');
}
function isUuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '')); }
