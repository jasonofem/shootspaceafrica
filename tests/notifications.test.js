import test from 'node:test';
import assert from 'node:assert/strict';

import {
  belongsToUser,
  formatUnreadCount,
  notificationBellLabel,
  notificationTime,
  notificationTitle,
} from '../src/lib/notifications.js';

test('known notification types read as plain sentences', () => {
  assert.equal(notificationTitle('booking_expired'), 'A booking request expired');
  assert.equal(notificationTitle('booking_request_created'), 'A new booking request needs your answer');
  assert.equal(notificationTitle('payout_eligible'), 'Your payout is now eligible');
  assert.equal(notificationTitle('host_verification_needs_changes'), 'Your host application needs changes');
  // Every type written by the database functions must have a sentence, not a raw code.
  for (const eventType of [
    'booking_request_accepted', 'booking_request_declined', 'booking_confirmed', 'booking_cancelled',
    'payment_confirmed', 'late_payment_review_required', 'late_payment_admin_review',
    'completion_confirmation_requested', 'host_verification_approved', 'host_verification_rejected',
    'host_verification_suspended', 'listing_review_published', 'listing_review_changes_requested',
    'listing_review_rejected', 'listing_review_paused', 'listing_submitted',
  ]) {
    const title = notificationTitle(eventType);
    assert.ok(title && !title.includes('_'), `${eventType} produced a raw code: ${title}`);
    assert.equal(title[0], title[0].toUpperCase(), `${eventType} did not start with a capital letter`);
  }
});

test('unknown and malformed notification types fall back to readable text', () => {
  assert.equal(notificationTitle('some_new_event'), 'Some new event');
  assert.equal(notificationTitle(''), 'New notification');
  assert.equal(notificationTitle(null), 'New notification');
  assert.equal(notificationTitle('!!!'), 'New notification');
  // Long or hostile codes are trimmed to a readable label instead of dumped raw.
  const long = notificationTitle(`${'x'.repeat(200)}_event`);
  assert.ok(long.length <= 80, `fallback was too long: ${long.length}`);
});

test('the badge text hides at zero and caps at 99+', () => {
  assert.equal(formatUnreadCount(0), '');
  assert.equal(formatUnreadCount(1), '1');
  assert.equal(formatUnreadCount(99), '99');
  assert.equal(formatUnreadCount(100), '99+');
  assert.equal(formatUnreadCount(4820), '99+');
  assert.equal(formatUnreadCount(null), '');
  assert.equal(formatUnreadCount('7'), '7');
  assert.equal(formatUnreadCount(-3), '');
});

test('the bell label is announced accessibly', () => {
  assert.equal(notificationBellLabel(0), 'Notifications');
  assert.equal(notificationBellLabel(3), 'Notifications, 3 unread');
  assert.equal(notificationBellLabel(120), 'Notifications, 120 unread');
});

test('notification times read as recent activity', () => {
  const now = Date.UTC(2026, 9, 16, 12, 0, 0);
  const ago = (minutes) => new Date(now - minutes * 60000).toISOString();
  assert.equal(notificationTime(ago(0), now), 'Just now');
  assert.equal(notificationTime(ago(5), now), '5 min ago');
  assert.equal(notificationTime(ago(59), now), '59 min ago');
  assert.equal(notificationTime(ago(60), now), '1 hour ago');
  assert.equal(notificationTime(ago(300), now), '5 hours ago');
  assert.equal(notificationTime(ago(1440), now), '1 day ago');
  assert.equal(notificationTime(ago(2880), now), '2 days ago');
  assert.match(notificationTime(ago(60 * 24 * 30), now), /2026/);
  assert.equal(notificationTime('not a date', now), 'Time not available');
  // A clock skew must never produce a negative time.
  assert.equal(notificationTime(new Date(now + 60000).toISOString(), now), 'Just now');
});

test('a notification is only ever matched to its own recipient', () => {
  assert.equal(belongsToUser({ recipient_id: 'user-1' }, 'user-1'), true);
  assert.equal(belongsToUser({ recipient_id: 'user-2' }, 'user-1'), false);
  assert.equal(belongsToUser({ recipient_id: 'user-1' }, ''), false);
  assert.equal(belongsToUser(null, 'user-1'), false);
});
