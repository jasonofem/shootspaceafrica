// Account area. Public URLs (unchanged):
//   GET         /api/me          -> account-me
//   GET         /api/dashboard   -> account-dashboard
//   POST/DELETE /api/favorites   -> account-favorites
//   POST        /api/contact     -> account-contact
import { createHmac } from 'node:crypto';
import { getServiceClient, requireRole, requireUser } from '../supabase.js';
import { methodNotAllowed, readBody, sendError } from '../http.js';

export async function me(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const { userClient, user } = await requireUser(req);
    const [{ data: profile, error: profileError }, { data: roles, error: rolesError }, { data: host, error: hostError }] = await Promise.all([
      userClient.from('profiles').select('id,display_name,phone,account_status').eq('id', user.id).maybeSingle(),
      userClient.from('user_roles').select('role').eq('user_id', user.id),
      userClient.from('host_profiles').select('verification_status,public_display_name').eq('user_id', user.id).maybeSingle(),
    ]);
    if (profileError) throw profileError;
    if (rolesError) throw rolesError;
    if (hostError && hostError.code !== 'PGRST116') throw hostError;
    res.setHeader('Cache-Control', 'no-store, private');
    return res.status(200).json({ user: { id: user.id, email: user.email }, profile, roles: (roles || []).map((item) => item.role), host: host || null });
  } catch (error) { return sendError(res, error, 'Account data could not be loaded.'); }
}

export async function dashboard(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const { userClient, user } = await requireUser(req);
    const role = String(req.query.role || 'creator');
    if (!['creator', 'host', 'admin'].includes(role)) return res.status(400).json({ error: 'Unknown dashboard role.' });
    await requireRole(userClient, user.id, role);
    const payload = role === 'creator' ? await creatorSummary(userClient, user.id) : role === 'host' ? await hostSummary(userClient, user.id) : await adminSummary(userClient);
    res.setHeader('Cache-Control', 'no-store, private');
    return res.status(200).json({ role, ...payload });
  } catch (error) { return sendError(res, error, 'Dashboard data could not be loaded.'); }
}

export async function favorites(req, res) {
  if (!['POST', 'DELETE'].includes(req.method)) return methodNotAllowed(res, ['POST', 'DELETE']);
  try {
    const { userClient } = await requireUser(req);
    const body = await readBody(req);
    if (!isUuid(body.listingId)) return res.status(400).json({ error: 'Listing id is required.' });
    const saved = req.method === 'POST';
    const { data, error } = await userClient.rpc('set_listing_favorite', { p_listing_id: body.listingId, p_saved: saved });
    if (error) throw error;
    return res.status(200).json(data);
  } catch (error) { return sendError(res, error, 'Saved location could not be updated.'); }
}

export async function contact(req, res) {
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

async function creatorSummary(client, userId) {
  const now = new Date().toISOString();
  const [bookings, favoritesResult, unread] = await Promise.all([
    client.from('bookings').select('id,public_code,listing_id,listing_title_snapshot,listing_city_snapshot,listing_neighbourhood_snapshot,starts_at,ends_at,booking_status,payment_status,payout_status,total_amount_kobo,creator_fee_kobo').eq('creator_id', userId).order('starts_at', { ascending: true }).limit(100),
    client.from('favorites').select('listing_id,created_at').eq('creator_id', userId).order('created_at', { ascending: false }).limit(100),
    client.from('notifications').select('id', { count: 'exact', head: true }).eq('recipient_id', userId).is('read_at', null),
  ]);
  for (const result of [bookings, favoritesResult, unread]) if (result.error) throw result.error;
  const rows = bookings.data || [];
  return {
    metrics: {
      upcomingBookings: rows.filter((item) => item.starts_at >= now && !['cancelled', 'declined', 'expired'].includes(item.booking_status)).length,
      pastBookings: rows.filter((item) => item.ends_at < now).length,
      savedSpaces: (favoritesResult.data || []).length,
      unreadNotifications: unread.count || 0,
    },
    bookings: rows,
    favoriteListingIds: (favoritesResult.data || []).map((item) => item.listing_id),
  };
}

async function hostSummary(client, userId) {
  const now = new Date().toISOString();
  const [bookings, listings, payouts, profile, changeRequests, withdrawals] = await Promise.all([
    client.from('bookings').select('id,public_code,listing_id,listing_title_snapshot,listing_city_snapshot,listing_neighbourhood_snapshot,starts_at,ends_at,booking_status,payment_status,payout_status,crew_size,production_type,host_share_kobo_snapshot,total_amount_kobo').eq('host_id', userId).order('starts_at', { ascending: true }).limit(150),
    client.from('listings').select('id,slug,title,status,city,neighbourhood,hourly_rate_kobo,min_hours,crew_capacity,description,public_location,category,house_rules').eq('owner_id', userId).order('created_at', { ascending: false }).limit(100),
    client.from('payouts').select('id,booking_id,amount_kobo,status,bookings(booking_status,payment_status)').eq('host_id', userId).limit(1000),
    client.from('host_profiles').select('public_display_name,verification_status,review_reason').eq('user_id', userId).maybeSingle(),
    client.from('listing_change_requests').select('id,listing_id,proposed_changes,reason,status,review_reason,created_at,reviewed_at').eq('requested_by', userId).order('created_at', { ascending: false }).limit(100),
    client.from('withdrawal_requests').select('id,amount_kobo,status,note,payment_reference,requested_at,paid_at,review_reason').eq('requester_id', userId).eq('requester_role', 'host').order('requested_at', { ascending: false }).limit(50),
  ]);
  for (const result of [bookings, listings, payouts, profile, changeRequests, withdrawals]) if (result.error) throw result.error;
  const sessions = bookings.data || [];
  const payoutRows = payouts.data || [];
  const livePaidStatuses = new Set(['confirmed', 'checked_in', 'completion_pending', 'completed', 'disputed']);
  const livePaidSessions = sessions.filter((item) => item.payment_status === 'paid' && livePaidStatuses.has(item.booking_status));
  // Same rule the withdrawal request applies: payout eligible AND the booking is still completed and paid (a dispute moves it out of 'completed').
  const requestablePayouts = payoutRows.filter((item) => item.status === 'eligible' && item.bookings?.booking_status === 'completed' && item.bookings?.payment_status === 'paid');
  return {
    metrics: {
      hostShareKobo: sumKobo(livePaidSessions, (item) => item.host_share_kobo_snapshot),
      paidOutKobo: sumKobo(payoutRows.filter((item) => item.status === 'paid'), (item) => item.amount_kobo),
      payoutPaidKobo: sumKobo(payoutRows.filter((item) => item.status === 'paid'), (item) => item.amount_kobo),
      payoutHeldKobo: sumKobo(livePaidSessions.filter((item) => item.payout_status === 'held'), (item) => item.host_share_kobo_snapshot),
      payoutEligibleKobo: sumKobo(livePaidSessions.filter((item) => item.payout_status === 'eligible'), (item) => item.host_share_kobo_snapshot),
      payoutAvailableKobo: sumKobo(requestablePayouts, (item) => item.amount_kobo),
      payoutRequestedKobo: sumKobo(payoutRows.filter((item) => item.status === 'queued'), (item) => item.amount_kobo),
      upcomingBookings: sessions.filter((item) => item.starts_at >= now && !['cancelled', 'declined', 'expired'].includes(item.booking_status)).length,
      completedShoots: sessions.filter((item) => item.booking_status === 'completed').length,
      listings: (listings.data || []).length,
    },
    payoutsByStatus: summarisePayouts(payoutRows),
    withdrawals: withdrawals.data || [],
    listingChangeRequests: changeRequests.data || [],
    bookings: sessions,
    listings: listings.data || [],
    host: profile.data || null,
  };
}

// Count and total per payout status, for the host's "Payouts & withdrawals" panel.
function summarisePayouts(rows) {
  const out = {};
  for (const row of rows) {
    const key = row.status || 'unknown';
    out[key] = out[key] || { count: 0, amountKobo: '0' };
    out[key].count += 1;
    out[key].amountKobo = (BigInt(out[key].amountKobo) + BigInt(row.amount_kobo || 0)).toString();
  }
  return out;
}

function sumKobo(rows, getValue) {
  return rows.reduce((sum, item) => sum + BigInt(getValue(item) || 0), 0n).toString();
}

async function adminSummary(client) {
  const [listings, hosts, bookings, payments, disputes, payouts, contacts, withdrawals, commissionClaims, changeRequests] = await Promise.all([
    client.from('listings').select('id,title,slug,owner_id,status,city,neighbourhood,created_at').eq('status', 'submitted').order('submitted_at', { ascending: true }).limit(100),
    client.from('host_profiles').select('user_id,public_display_name,verification_status,created_at').eq('verification_status', 'pending').order('created_at', { ascending: true }).limit(100),
    client.from('bookings').select('id,public_code,booking_status,payment_status,payout_status,total_amount_kobo,commission_kobo_snapshot,creator_fee_kobo,starts_at,ends_at,listing_title_snapshot,host_share_kobo_snapshot').order('created_at', { ascending: false }).limit(1000),
    client.from('payments').select('id,booking_id,provider_reference,status,amount_kobo,verified_at').order('created_at', { ascending: false }).limit(1000),
    client.from('disputes').select('id,booking_id,opened_by,dispute_type,description,status,created_at,refund_amount_kobo').order('created_at', { ascending: false }).limit(100),
    client.from('payouts').select('id,booking_id,host_id,amount_kobo,status').order('created_at', { ascending: false }).limit(1000),
    client.from('contact_requests').select('id,full_name,email,phone,subject,message,status,created_at').order('created_at', { ascending: false }).limit(100),
    client.from('withdrawal_requests').select('id,requester_id,requester_role,amount_kobo,status,note,payment_reference,requested_at,reviewed_at,paid_at,review_reason').order('requested_at', { ascending: false }).limit(200),
    client.from('withdrawal_request_commissions').select('booking_id').limit(5000),
    client.from('listing_change_requests').select('id,listing_id,requested_by,proposed_changes,reason,status,created_at').eq('status', 'pending').order('created_at', { ascending: true }).limit(100),
  ]);
  for (const result of [listings, hosts, bookings, payments, disputes, payouts, contacts, withdrawals, commissionClaims, changeRequests]) if (result.error) throw result.error;
  const bookingRows = bookings.data || [];
  const paymentRows = payments.data || [];
  const payoutRows = payouts.data || [];
  const withdrawalRows = withdrawals.data || [];
  const bookingById = new Map(bookingRows.map((item) => [item.id, item]));
  const disputeRows = (disputes.data || []).map((item) => ({ ...item, total_amount_kobo: bookingById.get(item.booking_id)?.total_amount_kobo || '0' }));
  const livePaidStatuses = new Set(['confirmed', 'checked_in', 'completion_pending', 'completed', 'disputed']);

  // Company commission: earned = captured and live; available = matured exactly like host payouts and not yet claimed.
  const claimedBookingIds = new Set((commissionClaims.data || []).map((row) => row.booking_id));
  const commissionEarnedRows = bookingRows.filter((item) => item.payment_status === 'paid' && livePaidStatuses.has(item.booking_status));
  const commissionAvailableRows = bookingRows.filter((item) => item.payment_status === 'paid' && item.booking_status === 'completed'
    && ['eligible', 'queued', 'processing', 'paid'].includes(item.payout_status) && !claimedBookingIds.has(item.id));
  const companyRequests = withdrawalRows.filter((item) => item.requester_role === 'platform');

  // Change requests with the live listing values, so the admin can see old -> new.
  const changeRows = changeRequests.data || [];
  const changeListingIds = [...new Set(changeRows.map((row) => row.listing_id))];
  const changeListings = changeListingIds.length
    ? await client.from('listings').select('id,title,owner_id,hourly_rate_kobo,min_hours,crew_capacity,description,public_location,category,house_rules').in('id', changeListingIds)
    : { data: [], error: null };
  if (changeListings.error) throw changeListings.error;
  const listingById = new Map((changeListings.data || []).map((row) => [row.id, row]));

  return {
    metrics: {
      listingReviewQueue: (listings.data || []).length,
      hostReviewQueue: (hosts.data || []).length,
      listingChangeQueue: changeRows.length,
      withdrawalQueue: withdrawalRows.filter((item) => ['pending', 'approved'].includes(item.status)).length,
      bookings: bookingRows.length,
      capturedPaymentsKobo: sumKobo(paymentRows.filter((item) => item.status === 'paid'), (item) => item.amount_kobo),
      commissionEarnedKobo: sumKobo(commissionEarnedRows, (item) => item.commission_kobo_snapshot),
      commissionAvailableKobo: sumKobo(commissionAvailableRows, (item) => item.commission_kobo_snapshot),
      commissionRequestedKobo: sumKobo(companyRequests.filter((item) => ['pending', 'approved'].includes(item.status)), (item) => item.amount_kobo),
      commissionWithdrawnKobo: sumKobo(companyRequests.filter((item) => item.status === 'paid'), (item) => item.amount_kobo),
      latePaidBookings: bookingRows.filter((item) => item.payment_status === 'paid' && !livePaidStatuses.has(item.booking_status)).length,
      openDisputes: disputeRows.filter((item) => !['resolved', 'closed'].includes(item.status)).length,
      payoutHeld: bookingRows.filter((item) => item.payout_status === 'held' && item.payment_status === 'paid' && livePaidStatuses.has(item.booking_status)).length,
      payoutsProcessing: payoutRows.filter((item) => ['eligible', 'queued', 'processing'].includes(item.status)).length,
      contactQueue: (contacts.data || []).filter((item) => item.status === 'new').length,
    },
    queues: {
      listings: listings.data || [],
      hosts: hosts.data || [],
      disputes: disputeRows,
      payments: paymentRows,
      bookings: bookingRows,
      contacts: contacts.data || [],
      payouts: payoutRows,
      withdrawals: withdrawalRows,
      listingChanges: changeRows.map((row) => ({ ...row, listing: listingById.get(row.listing_id) || null })),
    },
  };
}

function isUuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '')); }

export const accountRoutes = {
  defaultRoute: null,
  routes: {
    'account-me': me,
    'account-dashboard': dashboard,
    'account-favorites': favorites,
    'account-contact': contact,
  },
};
