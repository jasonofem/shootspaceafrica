// Admin area. Public URLs (unchanged):
//   POST /api/admin/listings/review  -> admin-listings-review
//   POST /api/admin/hosts/review     -> admin-hosts-review
//   POST /api/admin/disputes/resolve -> admin-disputes-resolve
//   POST /api/admin/listings/change-review -> admin-listing-change-review
//   POST /api/admin/withdrawals/review -> admin-withdrawal-review (records decisions only; sends no money)
//   POST /api/admin/reviews/hide     -> admin-reviews-hide (hides a published creator rating; audited)
import { requireRole, requireUser } from '../supabase.js';
import { methodNotAllowed, readBody, sendError } from '../http.js';

export async function reviewListing(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const { userClient, user } = await requireUser(req);
    await requireRole(userClient, user.id, 'admin');
    const body = await readBody(req);
    if (!isUuid(body.listingId) || !listingDecisions.has(String(body.decision))) return res.status(400).json({ error: 'Listing and review decision are required.' });
    const reason = String(body.reason || '').trim();
    if (reason.length < 5 || reason.length > 2000) return res.status(400).json({ error: 'An audit reason between 5 and 2,000 characters is required.' });
    const { data, error } = await userClient.rpc('admin_review_listing', { p_listing_id: body.listingId, p_decision: body.decision, p_reason: reason });
    if (error) throw error;
    return res.status(200).json(data);
  } catch (error) { return sendError(res, error, 'Listing review could not be completed.'); }
}

export async function reviewHost(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const { userClient, user } = await requireUser(req);
    await requireRole(userClient, user.id, 'admin');
    const body = await readBody(req);
    if (!isUuid(body.hostUserId) || !hostDecisions.has(String(body.decision))) return res.status(400).json({ error: 'Host and review decision are required.' });
    const reason = String(body.reason || '').trim();
    if (reason.length < 5 || reason.length > 2000) return res.status(400).json({ error: 'An audit reason between 5 and 2,000 characters is required.' });
    const { data, error } = await userClient.rpc('admin_review_host', { p_host_user_id: body.hostUserId, p_decision: body.decision, p_reason: reason });
    if (error) throw error;
    return res.status(200).json(data);
  } catch (error) { return sendError(res, error, 'Host review could not be completed.'); }
}

export async function resolveDispute(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const { userClient, user } = await requireUser(req);
    await requireRole(userClient, user.id, 'admin');
    const body = await readBody(req);
    if (!isUuid(body.disputeId) || !disputeDecisions.has(String(body.decision))) return res.status(400).json({ error: 'A valid dispute and decision are required.' });
    const reason = String(body.reason || '').trim();
    if (reason.length < 5 || reason.length > 2000) return res.status(400).json({ error: 'An audit reason between 5 and 2,000 characters is required.' });
    const refundAmount = Number(body.refundAmountKobo || 0);
    if (!Number.isSafeInteger(refundAmount) || refundAmount < 0) return res.status(400).json({ error: 'Refund amount must be integer kobo.' });
    const { data, error } = await userClient.rpc('admin_resolve_dispute', {
      p_dispute_id: body.disputeId,
      p_decision: body.decision,
      p_reason: reason,
      p_refund_amount_kobo: refundAmount,
    });
    if (error) throw error;
    return res.status(200).json(data);
  } catch (error) { return sendError(res, error, 'Dispute action could not be recorded.'); }
}

export async function reviewListingChange(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const { userClient, user } = await requireUser(req);
    await requireRole(userClient, user.id, 'admin');
    const body = await readBody(req);
    if (!isUuid(body.changeRequestId) || !['approve', 'reject'].includes(String(body.decision))) return res.status(400).json({ error: 'Change request and decision are required.' });
    const reason = String(body.reason || '').trim();
    if (reason.length < 5 || reason.length > 2000) return res.status(400).json({ error: 'An audit reason between 5 and 2,000 characters is required.' });
    const { data, error } = await userClient.rpc('admin_review_listing_change', { p_request_id: body.changeRequestId, p_decision: body.decision, p_reason: reason });
    if (error) throw error;
    return res.status(200).json(data);
  } catch (error) { return sendError(res, error, 'Listing change review could not be completed.'); }
}

// Records an admin decision on a withdrawal request. approve -> approved; mark_paid -> paid (the owner has
// already paid manually and enters the reference); reject -> releases the claimed funds.
export async function reviewWithdrawal(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const { userClient, user } = await requireUser(req);
    await requireRole(userClient, user.id, 'admin');
    const body = await readBody(req);
    if (!isUuid(body.requestId) || !withdrawalDecisions.has(String(body.decision))) return res.status(400).json({ error: 'Withdrawal request and decision are required.' });
    const reason = String(body.reason || '').trim();
    if (reason.length < 5 || reason.length > 2000) return res.status(400).json({ error: 'An audit reason between 5 and 2,000 characters is required.' });
    const paymentReference = String(body.paymentReference || '').trim();
    if (body.decision === 'mark_paid' && !/^[A-Za-z0-9 ._\/#:-]{3,100}$/.test(paymentReference)) {
      return res.status(400).json({ error: 'Enter the payment reference you used to pay (3–100 letters, numbers or . _ - / # : characters).' });
    }
    const { data, error } = await userClient.rpc('admin_review_withdrawal', {
      p_request_id: body.requestId, p_decision: body.decision, p_reason: reason, p_payment_reference: body.decision === 'mark_paid' ? paymentReference : null,
    });
    if (error) throw error;
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(data);
  } catch (error) { return sendError(res, error, 'Withdrawal review could not be completed.'); }
}

// Hides a published creator rating (sets it to 'rejected' with an audit log entry).
// The row is kept; it simply stops appearing in public averages, /api/reviews and the leaderboard.
export async function hideReview(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const { userClient, user } = await requireUser(req);
    await requireRole(userClient, user.id, 'admin');
    const body = await readBody(req);
    if (!isUuid(body.reviewId)) return res.status(400).json({ error: 'Rating id is required.' });
    const reason = String(body.reason || '').trim();
    if (reason.length < 5 || reason.length > 2000) return res.status(400).json({ error: 'An audit reason between 5 and 2,000 characters is required.' });
    const { data, error } = await userClient.rpc('admin_hide_review', { p_review_id: body.reviewId, p_reason: reason });
    if (error) throw error;
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(data);
  } catch (error) { return sendError(res, error, 'The rating could not be hidden.'); }
}

const withdrawalDecisions = new Set(['approve', 'mark_paid', 'reject']);
const listingDecisions = new Set(['approve', 'request_changes', 'reject', 'pause']);
const hostDecisions = new Set(['approve', 'request_changes', 'reject', 'suspend']);
const disputeDecisions = new Set(['request_more_evidence', 'release_payout', 'refund_full', 'refund_partial', 'split']);

function isUuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '')); }

export const adminRoutes = {
  defaultRoute: null,
  routes: {
    'admin-listings-review': reviewListing,
    'admin-hosts-review': reviewHost,
    'admin-disputes-resolve': resolveDispute,
    'admin-listing-change-review': reviewListingChange,
    'admin-withdrawal-review': reviewWithdrawal,
    'admin-reviews-hide': hideReview,
  },
};
