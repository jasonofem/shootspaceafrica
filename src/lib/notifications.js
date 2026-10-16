// Plain-English text for the notifications bell and panel.
//
// This module is intentionally dependency-free so it can be unit tested with `node --test`.
// It never reads `payload`: the panel shows a readable title derived from `event_type` and the
// time, and never raw JSON.

// Every event_type written by the database functions (see supabase/migrations) mapped to a
// sentence the recipient can act on. Keys must stay lowercase snake_case event_type values.
const NOTIFICATION_TITLES = Object.freeze({
  booking_request_created: 'A new booking request needs your answer',
  booking_request_accepted: 'The host accepted your booking request',
  booking_request_declined: 'The host declined your booking request',
  booking_confirmed: 'A booking was confirmed and paid',
  booking_cancelled: 'A booking was cancelled',
  booking_expired: 'A booking request expired',
  payment_confirmed: 'Your payment was confirmed',
  late_payment_review_required: 'A payment arrived late and is under review',
  late_payment_admin_review: 'A late payment needs an admin review',
  completion_confirmation_requested: 'Confirm that the session was completed',
  payout_eligible: 'Your payout is now eligible',
  host_verification_approved: 'Your host application was approved',
  host_verification_needs_changes: 'Your host application needs changes',
  host_verification_rejected: 'Your host application was rejected',
  host_verification_suspended: 'Your host account was suspended',
  host_verification_pending: 'Your host application is being reviewed',
  host_verification_not_started: 'Your host application was reset',
  listing_review_published: 'Your listing was published',
  listing_review_changes_requested: 'Your listing needs changes',
  listing_review_rejected: 'Your listing was rejected',
  listing_review_paused: 'Your listing was paused',
  listing_change_requested: 'A host asked to change a live listing',
  listing_change_approved: 'Your requested listing change was approved',
  listing_change_rejected: 'Your requested listing change was not approved',
  withdrawal_requested: 'A withdrawal request needs your review',
  withdrawal_approved: 'Your withdrawal request was approved',
  withdrawal_paid: 'Your withdrawal was marked paid',
  withdrawal_rejected: 'Your withdrawal request was not approved',
  listing_submitted: 'A listing was submitted for review',
});

const FALLBACK_TITLE = 'New notification';
const MAX_FALLBACK_WORDS = 12;
const MAX_FALLBACK_LENGTH = 72;

/**
 * Readable title for a notification. Known event types get a full sentence; anything unknown is
 * turned into a readable label (for example `some_new_event` -> "Some new event") instead of
 * showing a raw code or JSON.
 */
export function notificationTitle(eventType) {
  const key = typeof eventType === 'string' ? eventType.trim().toLowerCase() : '';
  if (NOTIFICATION_TITLES[key]) return NOTIFICATION_TITLES[key];
  const words = key.replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).slice(0, MAX_FALLBACK_WORDS);
  if (!words.length) return FALLBACK_TITLE;
  const sentence = words.join(' ').slice(0, MAX_FALLBACK_LENGTH).trim();
  if (!sentence) return FALLBACK_TITLE;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/** Badge text: "" at zero, "99+" above 99, otherwise the exact count. */
export function formatUnreadCount(count) {
  const value = Math.max(0, Math.floor(Number(count) || 0));
  if (value === 0) return '';
  return value > 99 ? '99+' : String(value);
}

/** Accessible label for the bell button, for example "Notifications, 3 unread". */
export function notificationBellLabel(count) {
  const value = Math.max(0, Math.floor(Number(count) || 0));
  if (value === 0) return 'Notifications';
  return `Notifications, ${value} unread`;
}

/**
 * Short time for a notification, in the same Africa/Lagos convention the rest of the app uses.
 * Falls back to a medium date once a notification is a week old.
 */
export function notificationTime(value, now = Date.now()) {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return 'Time not available';
  const minutes = Math.floor((now - date.valueOf()) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeZone: 'Africa/Lagos' }).format(date);
}

/**
 * The notifications panel is only ever allowed to name the caller's own rows on the client side
 * too: the list query filters by recipient_id even though the database policy already does it.
 */
export function belongsToUser(row, userId) {
  return Boolean(userId) && row?.recipient_id === userId;
}
