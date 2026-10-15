import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { getServiceClient } from '../_lib/supabase.js';
import { methodNotAllowed, sendError } from '../_lib/http.js';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret || process.env.PAYMENT_PROVIDER !== 'paystack') return res.status(503).json({ error: 'Payment webhook is not configured.' });
  try {
    const rawBody = await readRawBody(req);
    const signature = String(req.headers['x-paystack-signature'] || '');
    const expected = createHmac('sha512', secret).update(rawBody).digest('hex');
    if (!safeHexEqual(signature, expected)) return res.status(401).json({ error: 'Invalid webhook signature.' });
    const event = JSON.parse(rawBody.toString('utf8'));
    const payload = event?.data || {};
    const reference = String(payload.reference || '');
    const eventType = String(event.event || '');
    if (!reference || !['charge.success', 'charge.failed'].includes(eventType)) return res.status(200).json({ received: true, ignored: true });
    const eventId = createHash('sha256').update(rawBody).digest('hex');
    const safePayload = {
      event: eventType,
      reference,
      amount: Number(payload.amount || 0),
      currency: String(payload.currency || ''),
      paid_at: String(payload.paid_at || ''),
    };
    const service = getServiceClient();
    const { data, error } = await service.rpc('process_verified_paystack_event', {
      p_event_id: eventId,
      p_reference: reference,
      p_amount_kobo: Number(payload.amount || 0),
      p_currency: String(payload.currency || ''),
      p_event_type: eventType,
      p_payload: safePayload,
    });
    if (error) throw error;
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ received: true, processed: Boolean(data?.processed), duplicate: Boolean(data?.duplicate) });
  } catch (error) { return sendError(res, error, 'Webhook processing failed.'); }
}

function safeHexEqual(received, expected) {
  if (!/^[a-f\d]+$/i.test(received) || received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex'));
}
async function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw Object.assign(new Error('Webhook body too large.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
