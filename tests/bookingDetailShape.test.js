import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildBookingDetailPayload } from '../api/_lib/endpoints/bookings.js';

const root = fileURLToPath(new URL('..', import.meta.url));

const baseRow = {
  id: 'b1',
  public_code: 'SSA-TEST-1',
  listing_id: 'l1',
  listing_title_snapshot: 'Snapshot title',
  listing_city_snapshot: 'Lagos',
  listing_neighbourhood_snapshot: 'Ikoyi',
  starts_at: '2026-10-20T09:00:00+01:00',
  ends_at: '2026-10-20T17:00:00+01:00',
  crew_size: 4,
  production_type: 'Photo shoot',
  booking_status: 'confirmed',
  payment_status: 'paid',
  payout_status: 'held',
  total_amount_kobo: 2500000,
  creator_fee_kobo: 0,
  host_share_kobo_snapshot: 2125000,
  creator_id: 'creator-uuid',
  host_id: 'host-uuid',
};

test('booking detail payload tells each participant their role without leaking user ids', () => {
  const asCreator = buildBookingDetailPayload(baseRow, null, 'creator-uuid');
  assert.equal(asCreator.viewerRole, 'creator');
  const asHost = buildBookingDetailPayload(baseRow, null, 'host-uuid');
  assert.equal(asHost.viewerRole, 'host');
  const asOther = buildBookingDetailPayload(baseRow, null, 'someone-else');
  assert.equal(asOther.viewerRole, null);
  for (const payload of [asCreator, asHost, asOther]) {
    assert.equal(payload.booking.creator_id, undefined);
    assert.equal(payload.booking.host_id, undefined);
  }
});

test('without private details the payload keeps snapshot fields and never includes an arrival address', () => {
  const payload = buildBookingDetailPayload(baseRow, null, 'creator-uuid');
  assert.equal(payload.privateDetailsAvailable, false);
  assert.equal(payload.booking.listing.title, 'Snapshot title');
  assert.equal(payload.booking.listing.city, 'Lagos');
  assert.equal(payload.booking.listing.exact_address, undefined);
  assert.equal(payload.booking.host, undefined);
});

test('paid bookings merge private listing and host details into the booking', () => {
  const privateDetails = {
    id: 'b1',
    public_code: 'SSA-TEST-1',
    booking_status: 'confirmed',
    payment_status: 'paid',
    payout_status: 'held',
    starts_at: baseRow.starts_at,
    ends_at: baseRow.ends_at,
    crew_size: 4,
    production_type: 'Photo shoot',
    base_amount_kobo: 2500000,
    total_amount_kobo: 2500000,
    listing: { title: 'Real title', city: 'Lagos', neighbourhood: 'Ikoyi', exact_address: '12 Example Street' },
    host: { public_display_name: 'Amaka Studios' },
  };
  const payload = buildBookingDetailPayload(baseRow, privateDetails, 'creator-uuid');
  assert.equal(payload.privateDetailsAvailable, true);
  assert.equal(payload.booking.listing.exact_address, '12 Example Street');
  assert.equal(payload.booking.host.public_display_name, 'Amaka Studios');
  assert.equal(payload.booking.viewerRole, undefined);
});

test('the booking detail payload keeps the plain fields the check-in room renders', () => {
  const payload = buildBookingDetailPayload(baseRow, null, 'host-uuid');
  for (const field of ['id', 'public_code', 'starts_at', 'ends_at', 'crew_size', 'production_type', 'booking_status', 'payment_status', 'payout_status']) {
    assert.ok(field in payload.booking, `booking.${field} must stay available to the page`);
  }
});

// Regression guard for the blank check-in room: OtpRoomPage must read the
// `booking` state that useBookingDetails returns. Reading a different key
// (for example `data.booking`) makes the page crash into a blank screen.
test('OtpRoomPage reads the booking object returned by useBookingDetails', () => {
  const source = readFileSync(join(root, 'src/App.jsx'), 'utf8');
  const hook = source.match(/function useBookingDetails\(bookingId\) \{[\s\S]*?\n\}/);
  assert.ok(hook, 'useBookingDetails must exist');
  assert.match(hook[0], /return \{\.\.\.state,\s*refresh\}/, 'hook state is spread directly onto the return value');

  const page = source.match(/function OtpRoomPage\(\) \{[\s\S]*?\n\}/);
  assert.ok(page, 'OtpRoomPage must exist');
  assert.match(page[0], /const \{[^}]*\bbooking\b[^}]*\} ?= ?useBookingDetails\(/, 'OtpRoomPage must destructure `booking` from the hook');
  assert.doesNotMatch(page[0], /data\?\.booking/, 'OtpRoomPage must not read a nonexistent `data` key');
  assert.match(page[0], /if\(!booking\)/, 'OtpRoomPage must guard against a missing booking before rendering');
});

test('routes are wrapped in an error boundary so crashes never blank the page', () => {
  const source = readFileSync(join(root, 'src/App.jsx'), 'utf8');
  assert.match(source, /class AppErrorBoundary extends Component/, 'an error boundary component must exist');
  assert.match(source, /<RouteErrorBoundary>[\s\S]*<Routes>/, 'the routes tree must be wrapped in the boundary');
  assert.match(source, /function safeErrorText/, 'error text shown to users must pass through a redacting helper');
});
