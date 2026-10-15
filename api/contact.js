import { createHmac } from 'node:crypto';
import { getServiceClient } from './_lib/supabase.js';
import { methodNotAllowed, readBody, sendError } from './_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  if (!process.env.CONTACT_RATE_LIMIT_SECRET || Buffer.byteLength(process.env.CONTACT_RATE_LIMIT_SECRET) < 32) {
    return res.status(503).json({ error: 'The secure contact form is not configured yet. Please use the direct contact options below.' });
  }
  try {
    const body = await readBody(req);
    if (String(body.website || '').trim()) return res.status(202).json({ received: true });
    const fullName = String(body.fullName || '').trim().slice(0, 120);
    const email = String(body.email || '').trim().toLowerCase().slice(0, 254);
    const phone = String(body.phone || '').trim().slice(0, 40);
    const subject = String(body.subject || '').trim().slice(0, 160);
    const message = String(body.message || '').trim().slice(0, 10000);
    if (fullName.length < 2 || !/^\S+@\S+\.\S+$/.test(email) || subject.length < 2 || message.length < 10 || body.consent !== true) {
      return res.status(400).json({ error: 'Check your name, email, subject, message and consent, then try again.' });
    }
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    const fingerprint = createHmac('sha256', process.env.CONTACT_RATE_LIMIT_SECRET).update(ip).digest('hex');
    const service = getServiceClient();
    const { data, error } = await service.rpc('create_contact_request', {
      p_full_name: fullName,
      p_email: email,
      p_phone: phone,
      p_subject: subject,
      p_message: message,
      p_ip_fingerprint: fingerprint,
    });
    if (error) throw error;

    let emailSent = false;
    const recipient = String(process.env.CONTACT_NOTIFICATION_TO || '').trim();
    if (process.env.RESEND_API_KEY && process.env.MAIL_FROM && recipient) {
      try {
        const result = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: process.env.MAIL_FROM,
            to: [recipient],
            reply_to: email,
            subject: `ShootSpace enquiry: ${subject}`,
            text: `Name: ${fullName}\nEmail: ${email}\nPhone: ${phone || 'Not supplied'}\n\n${message}`,
          }),
        });
        emailSent = result.ok;
      } catch { emailSent = false; }
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(201).json({ received: true, emailSent, reference: data?.id || null });
  } catch (error) {
    return sendError(res, error, 'Contact request could not be submitted.');
  }
}
