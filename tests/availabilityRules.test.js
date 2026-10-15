import test from 'node:test';
import assert from 'node:assert/strict';
import { assessTimeSlot } from '../src/lib/businessRules.js';

const base = {
  date: '2026-10-11',
  startTime: '10:00',
  durationHours: 2,
  openingHours: [{ opens_at: '09:00:00', closes_at: '18:00:00' }],
  busySlots: [],
  blockedIntervals: [],
  now: Date.parse('2026-10-01T00:00:00Z'),
};

test('a future whole-hour slot inside opening hours is tentatively available', () => {
  assert.equal(assessTimeSlot(base).available, true);
});

test('a booking request is rejected outside hours, in the past, or over midnight', () => {
  assert.equal(assessTimeSlot({ ...base, startTime: '08:00' }).available, false);
  assert.equal(assessTimeSlot({ ...base, startTime: '23:00', durationHours: 2 }).available, false);
  assert.equal(assessTimeSlot({ ...base, date: '2026-09-30' }).available, false);
  assert.equal(assessTimeSlot({ ...base, startTime: '10:30' }).available, false);
  assert.equal(assessTimeSlot({ ...base, date: '2026-02-31' }).available, false);
});

test('busy bookings and blocked host intervals use half-open overlap checks', () => {
  assert.equal(assessTimeSlot({
    ...base,
    busySlots: [{ starts_at: '2026-10-11T10:00:00+01:00', ends_at: '2026-10-11T11:00:00+01:00' }],
  }).available, false);
  assert.equal(assessTimeSlot({
    ...base,
    blockedIntervals: [{ starts_at: '2026-10-11T11:00:00+01:00', ends_at: '2026-10-11T13:00:00+01:00' }],
  }).available, false);
  assert.equal(assessTimeSlot({
    ...base,
    busySlots: [{ starts_at: '2026-10-11T12:00:00+01:00', ends_at: '2026-10-11T13:00:00+01:00' }],
  }).available, true);
});
