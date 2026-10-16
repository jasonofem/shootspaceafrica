import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bookingRoutes } from '../api/_lib/endpoints/bookings.js';
import { adminRoutes } from '../api/_lib/endpoints/admin.js';
import { compareByRatingRank, hasEstablishedRating, ratingSummary, MIN_RATINGS_FOR_RANK } from '../src/lib/businessRules.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');

const MIGRATION = 'supabase/migrations/20261018000000_ratings_and_leaderboard.sql';
const migration = read(MIGRATION);
const vercelConfig = JSON.parse(read('vercel.json'));

test('the new migration replaces the 1-5 rating rule with 3-5 and never deletes old rows', () => {
  assert.match(migration, /drop constraint if exists reviews_rating_check/);
  assert.match(migration, /add constraint reviews_rating_check check \(rating between 3 and 5\) not valid/);
  // Old sub-3 rows are never deleted: validation only happens when nothing violates the rule.
  assert.match(migration, /if not exists \(select 1 from public\.reviews where rating < 3\)/);
  assert.match(migration, /validate constraint reviews_rating_check/);
  assert.doesNotMatch(migration, /delete from public\.reviews/i);
});

test('submit_review enforces every rating rule in the database, not just the client', () => {
  for (const code of [
    'authentication_required', 'booking_not_found', 'review_not_for_your_booking',
    'review_requires_completed_booking', 'review_requires_paid_booking',
    'review_blocked_by_open_dispute', 'review_rating_out_of_range',
    'review_body_too_long', 'review_already_submitted',
  ]) assert.match(migration, new RegExp(`raise exception '${code}'`), `${code} must be raised by submit_review`);
  assert.match(migration, /p_rating < 3 or p_rating > 5/);
  assert.match(migration, /char_length\(coalesce\(p_body, ''\)\) > 1000/);
  assert.match(migration, /booking_status <> 'completed'/);
  assert.match(migration, /payment_status <> 'paid'/);
  assert.match(migration, /status not in \('resolved','closed'\)/);
  assert.match(migration, /r\.reviewer_id = v_user/);
  // Ratings publish immediately (owner decision) through the security-definer function.
  assert.match(migration, /'published'\)\s*returning \* into v_review/);
  assert.match(migration, /security definer set search_path = public/);
});

test('admins can hide a rating and every hide is audited', () => {
  assert.match(migration, /create or replace function public\.admin_hide_review\(p_review_id uuid, p_reason text\)/);
  assert.match(migration, /if not public\.is_admin\(\) then raise exception 'admin_role_required'/);
  assert.match(migration, /raise exception 'review_not_found'/);
  assert.match(migration, /set moderation_status = 'rejected'/);
  assert.match(migration, /'review_hidden', 'reviews'/);
  // Grants follow the existing pattern: revoke from public first, then targeted grants.
  assert.match(migration, /revoke all on function public\.admin_hide_review\(uuid, text\) from public/);
  assert.match(migration, /grant execute on function public\.admin_hide_review\(uuid, text\) to authenticated/);
  assert.match(migration, /revoke all on function public\.submit_review\(uuid, int, text\) from public/);
  assert.match(migration, /grant execute on function public\.submit_review\(uuid, int, text\) to authenticated/);
  assert.match(migration, /revoke all on public\.listing_rankings from public/);
  assert.match(migration, /grant select on public\.listing_rankings to anon, authenticated/);
});

test('the leaderboard view only ranks published listings and applies the 3-rating rule', () => {
  assert.match(migration, /create or replace view public\.listing_rankings/);
  assert.match(migration, /moderation_status = 'published'/);
  assert.match(migration, /join public\.public_listings pl on pl\.id = rd\.listing_id/);
  assert.match(migration, /case when rd\.rating_count >= 3 then 1 else 0 end\) desc/);
  assert.match(migration, /rd\.avg_rating desc,\s*rd\.rating_count desc,\s*rd\.latest_rating_at desc/);
});

test('every rating error code has a friendly message in the api known set', () => {
  const http = read('api/_lib/http.js');
  const block = http.slice(http.indexOf('const known = new Set(['), http.indexOf(']);', http.indexOf('const known = new Set([')));
  for (const code of [
    'review_not_for_your_booking', 'review_requires_completed_booking', 'review_requires_paid_booking',
    'review_blocked_by_open_dispute', 'review_rating_out_of_range', 'review_body_too_long',
    'review_already_submitted', 'review_not_found', 'booking_not_found',
  ]) assert.ok(block.includes(`'${code}'`), `${code} missing from the known set in api/_lib/http.js`);
});

test('the review routes are grouped, rewritten and public', () => {
  assert.equal(typeof bookingRoutes.routes['bookings-review'], 'function');
  assert.equal(typeof adminRoutes.routes['admin-reviews-hide'], 'function');
  const rewrites = Object.fromEntries(vercelConfig.rewrites.map((rewrite) => [rewrite.source, rewrite.destination]));
  assert.equal(rewrites['/api/bookings/review'], '/api/bookings?route=bookings-review');
  assert.equal(rewrites['/api/admin/reviews/hide'], '/api/admin?route=admin-reviews-hide');
  // The static rewrite must come before the dynamic /api/bookings/:id rewrite.
  const sources = vercelConfig.rewrites.map((rewrite) => rewrite.source);
  assert.ok(sources.indexOf('/api/bookings/review') < sources.indexOf('/api/bookings/:id'));
});

test('a space with fewer than 3 ratings never ranks above one with 3 or more', () => {
  assert.equal(MIN_RATINGS_FOR_RANK, 3);
  const oneFiveStar = { rating: 5, reviews: 1 };
  const threeFourStar = { rating: 4, reviews: 3 };
  const sorted = [oneFiveStar, threeFourStar].sort(compareByRatingRank);
  assert.equal(sorted[0], threeFourStar, 'the 3-rating 4.0 space must outrank the 1-rating 5.0 space');
  assert.equal(hasEstablishedRating(oneFiveStar), false);
  assert.equal(hasEstablishedRating(threeFourStar), true);
  // Among established spaces: higher average wins, then more ratings, then the newest rating.
  const order = [
    { rating: 4.3, reviews: 4 },
    { rating: 4.7, reviews: 3 },
    { rating: 4.7, reviews: 9 },
    { rating: 5, reviews: 2 },
  ].sort(compareByRatingRank);
  assert.deepEqual(order.map((space) => `${space.rating}x${space.reviews}`), ['4.7x9', '4.7x3', '4.3x4', '5x2']);
  // Newest-rating tiebreak for identical average and count.
  const twins = [
    { rating: 4, reviews: 3, latestRatingAt: '2026-09-01T10:00:00Z' },
    { rating: 4, reviews: 3, latestRatingAt: '2026-10-01T10:00:00Z' },
  ].sort(compareByRatingRank);
  assert.equal(twins[0].latestRatingAt, '2026-10-01T10:00:00Z');
});

test('cards show New instead of a misleading average under 3 ratings', () => {
  assert.deepEqual(ratingSummary({ rating: null, reviews: 0 }), { kind: 'none', label: 'No ratings yet' });
  assert.equal(ratingSummary({ rating: 5, reviews: 1 }).kind, 'new');
  assert.equal(ratingSummary({ rating: 5, reviews: 1 }).label, 'New · 1 rating');
  assert.equal(ratingSummary({ rating: 4.7, reviews: 2 }).label, 'New · 2 ratings');
  assert.deepEqual(ratingSummary({ rating: 4.7, reviews: 12 }), { kind: 'established', label: '4.7 (12 ratings)' });
});

test('the creator dashboard and rating prompt use the confirmed rules and honest copy', () => {
  const app = read('src/App.jsx');
  assert.match(app, /Rate your sessions/);
  assert.match(app, /\/api\/bookings\/review/);
  assert.match(app, /Ratings come from creators after completed, paid sessions only/);
  assert.match(app, /Top rated spaces/);
  // The prompt offers exactly 3, 4 and 5 stars.
  assert.match(app, /\[3,4,5\]\.map/);
  const account = read('api/_lib/endpoints/account.js');
  assert.match(account, /ratingsDue/);
  assert.match(account, /booking_status === 'completed' && item\.payment_status === 'paid' && !ratedBookingIds\.has\(item\.id\)/);
});
