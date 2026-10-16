// Payments area. Public URLs (unchanged):
//   POST /api/payments/initialize -> payments-initialize
//   GET  /api/payments/status     -> payments-status
//
// Vendor webhooks stay on their own function so the raw body signature check
// keeps running with the body parser disabled: /api/webhooks/paystack.
import { randomUUID } from 'node:crypto';
import { getServiceClient, requireUser } from '../supabase.js';
import { methodNotAllowed, readBody, sendError } from '../http.js';

export async function initializePayment(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (process.env.PAYMENT_ENABLED !== 'true' || process.env.PAYMENT_PROVIDER !== 'paystack' || !secret || !process.env.PAYMENT_RETURN_URL) {
    return res.status(503).json({ error: 'Online payments are not enabled. Provider approval and payment policy setup are still required.' });
  }
  try {
    const { userClient, user } = await requireUser(req);
    const body = await readBody(req);
    if (!isUuid(body.bookingId) || !isUuid(body.idempotencyKey)) return res.status(400).json({ error: 'Booking id and payment idempotency key are required.' });
    if (!user.email) return res.status(400).json({ error: 'A confirmed email address is required for payment.' });
    const reference = `SSA-${randomUUID()}`;
    const prepared = await userClient.rpc('prepare_booking_payment', {
      p_booking_id: body.bookingId,
      p_provider: 'paystack',
      p_provider_reference: reference,
      p_idempotency_key: body.idempotencyKey,
    });
    if (prepared.error) throw prepared.error;
    const payment = prepared.data;
    const amountKobo = Number(payment?.amount_kobo);
    if (!Number.isSafeInteger(amountKobo) || amountKobo <= 0) return res.status(503).json({ error: 'The booking amount cannot be represented safely for payment initialization.' });
    if (payment.authorization_url) return res.status(200).json({ authorization_url: payment.authorization_url, reference: payment.reference, status: payment.status });

    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: user.email,
        amount: amountKobo,
        currency: 'NGN',
        reference: payment.reference,
        callback_url: process.env.PAYMENT_RETURN_URL,
        metadata: { booking_id: body.bookingId, payment_id: payment.payment_id },
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.status || !result.data?.authorization_url) {
      const service = getServiceClient();
      await service.from('payments').update({ status: 'failed', provider_metadata: { initialization_failed: true } }).eq('provider_reference', payment.reference).eq('status', 'pending');
      await service.from('bookings').update({ payment_status: 'failed', booking_status: 'accepted_awaiting_payment' }).eq('id', body.bookingId).eq('booking_status', 'payment_pending');
      return res.status(502).json({ error: 'The payment provider could not start this transaction. Your booking has not been confirmed. You may retry while the request is valid.' });
    }
    const service = getServiceClient();
    const update = await service.from('payments').update({ authorization_url: result.data.authorization_url, provider_metadata: { access_code: result.data.access_code } }).eq('provider_reference', payment.reference).eq('status', 'pending');
    if (update.error) throw update.error;
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ authorization_url: result.data.authorization_url, reference: payment.reference, status: 'pending' });
  } catch (error) { return sendError(res, error, 'Payment initialization failed. No payment has been confirmed.'); }
}

export async function paymentStatus(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const { userClient } = await requireUser(req);
    const reference = String(req.query.reference || '').trim().slice(0, 100);
    if (!/^SSA-[A-Za-z0-9-]{10,90}$/.test(reference)) return res.status(400).json({ error: 'A valid payment reference is required.' });
    const { data, error } = await userClient.from('payments').select('booking_id,status,amount_kobo,currency').eq('provider_reference', reference).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Payment was not found for this account.' });
    res.setHeader('Cache-Control', 'no-store, private');
    return res.status(200).json({ bookingId: data.booking_id, status: data.status, amountKobo: data.amount_kobo, currency: data.currency });
  } catch (error) { return sendError(res, error, 'Payment status could not be checked.'); }
}

function isUuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '')); }

export const paymentRoutes = {
  defaultRoute: null,
  routes: {
    'payments-initialize': initializePayment,
    'payments-status': paymentStatus,
  },
};
