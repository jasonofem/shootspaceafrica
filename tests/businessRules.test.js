import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLATFORM_COMMISSION_BPS,
  calculateBookingBaseKobo,
  calculateCheckoutKobo,
  calculateCommissionKobo,
  calculateHostShareKobo,
  canTransitionBooking,
  isValidBookingInterval,
  parseNairaToKobo,
} from '../src/lib/businessRules.js';

test('commission is fixed at exactly 15% with integer-kobo rounding', () => {
  assert.equal(PLATFORM_COMMISSION_BPS, 1500);
  assert.equal(calculateCommissionKobo(100_000n), 15_000n);
  assert.equal(calculateHostShareKobo(100_000n), 85_000n);
  assert.equal(calculateCommissionKobo(100_000n, 1200), 15_000n);
  assert.equal(calculateCommissionKobo(4n), 1n); // 0.6 kobo rounds half up.
});

test('commission and host share always allocate the booking base exactly', () => {
  for (const base of [0n, 1n, 2n, 3n, 4n, 99n, 100n, 9_999n, 1_000_000_001n]) {
    assert.equal(calculateCommissionKobo(base) + calculateHostShareKobo(base), base);
  }
});

test('creator checkout fees are separate and must be non-negative', () => {
  assert.equal(calculateCheckoutKobo(50_000n, 2_500n), 52_500n);
  assert.equal(calculateCheckoutKobo('50000', '0'), 50_000n);
  assert.throws(() => calculateCheckoutKobo(100n, -1n), RangeError);
  assert.throws(() => calculateCommissionKobo('1.25'), TypeError);
});

test('NGN text converts to integer kobo without floating point', () => {
  assert.equal(parseNairaToKobo('1'), 100n);
  assert.equal(parseNairaToKobo('1.2'), 120n);
  assert.equal(parseNairaToKobo('1.09'), 109n);
  assert.equal(parseNairaToKobo('0.00'), 0n);
  for (const value of ['', '-1', '1.234', 'NaN', '1,000']) {
    assert.throws(() => parseNairaToKobo(value), TypeError);
  }
});

test('booking transitions keep payment, check-in and completion separate', () => {
  assert.equal(canTransitionBooking('request_pending', 'accepted_awaiting_payment'), true);
  assert.equal(canTransitionBooking('accepted_awaiting_payment', 'confirmed'), false);
  assert.equal(canTransitionBooking('payment_pending', 'confirmed'), true);
  assert.equal(canTransitionBooking('confirmed', 'checked_in'), true);
  assert.equal(canTransitionBooking('checked_in', 'completed'), false);
  assert.equal(canTransitionBooking('completion_pending', 'completed'), true);
  assert.equal(canTransitionBooking('disputed', 'completed'), true);
  assert.equal(canTransitionBooking('declined', 'confirmed'), false);
});

test('booking interval validation rejects malformed and zero-length intervals', () => {
  assert.equal(isValidBookingInterval('2026-10-11T09:00:00Z', '2026-10-11T10:00:00Z'), true);
  assert.equal(isValidBookingInterval('2026-10-11T10:00:00Z', '2026-10-11T09:00:00Z'), false);
  assert.equal(isValidBookingInterval('bad', '2026-10-11T10:00:00Z'), false);
  assert.equal(isValidBookingInterval('2026-10-11T09:00:00Z', '2026-10-11T09:00:00Z'), false);
});

test('booking base multiplies the per-person hourly rate by hours and crew', () => {
  // Owner's own case: NGN 5,000 per person per hour x 12 people x 5 hours = NGN 300,000.
  assert.equal(calculateBookingBaseKobo({ hourlyRateKobo: 500_000, hours: 5, crewSize: 12 }), 30_000_000n);
  assert.equal(calculateBookingBaseKobo({ hourlyRateKobo: 1_500_000, hours: 2, crewSize: 3 }), 9_000_000n);
});

test('crew of one reproduces the old rate-times-hours price', () => {
  assert.equal(calculateBookingBaseKobo({ hourlyRateKobo: 1_500_000, hours: 2, crewSize: 1 }), 3_000_000n);
  assert.equal(calculateBookingBaseKobo({ hourlyRateKobo: 9_500_000n, hours: 4n, crewSize: 1n }), 38_000_000n);
});

test('booking base rejects zero, negative, fractional and unsafe inputs', () => {
  const valid = { hourlyRateKobo: 500_000, hours: 2, crewSize: 2 };
  for (const bad of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
    assert.throws(() => calculateBookingBaseKobo({ ...valid, hourlyRateKobo: bad }), /Hourly rate/);
    assert.throws(() => calculateBookingBaseKobo({ ...valid, hours: bad }), /Hours/);
    assert.throws(() => calculateBookingBaseKobo({ ...valid, crewSize: bad }), /Crew size/);
  }
  assert.throws(() => calculateBookingBaseKobo({ ...valid, crewSize: '2' }), TypeError);
  assert.throws(() => calculateBookingBaseKobo({ hourlyRateKobo: 0n, hours: 1, crewSize: 1 }), RangeError);
});
