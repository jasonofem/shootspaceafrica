export const PLATFORM_COMMISSION_BPS = 1500;

// Creator ratings leaderboard (owner decision 2026-10-16): a space needs at least
// MIN_RATINGS_FOR_RANK published ratings to rank above spaces with fewer ratings.
// Ties: higher average first, then more ratings first, then the newest rating first.
export const MIN_RATINGS_FOR_RANK = 3;

export function hasEstablishedRating(space) {
  return Number(space?.reviews || 0) >= MIN_RATINGS_FOR_RANK;
}

// Sorts spaces for the "Top rated" leaderboard. Accepts objects shaped like
// normalizeListing output ({ rating, reviews }) or { averageRating, ratingCount, latestRatingAt }.
export function compareByRatingRank(left, right) {
  const a = normalizeRatingInput(left);
  const b = normalizeRatingInput(right);
  const aRanked = a.count >= MIN_RATINGS_FOR_RANK;
  const bRanked = b.count >= MIN_RATINGS_FOR_RANK;
  if (aRanked !== bRanked) return aRanked ? -1 : 1;
  if (b.average !== a.average) return b.average - a.average;
  if (b.count !== a.count) return b.count - a.count;
  return String(b.latest).localeCompare(String(a.latest));
}

function normalizeRatingInput(space) {
  const average = Number(space?.rating ?? space?.averageRating ?? 0);
  const count = Number(space?.reviews ?? space?.ratingCount ?? 0);
  return {
    average: Number.isFinite(average) ? average : 0,
    count: Number.isFinite(count) ? count : 0,
    latest: space?.latestRatingAt || '',
  };
}

// Card/detail label: never show an average from fewer than 3 ratings ("New" instead),
// so a single 5-star rating cannot be mistaken for an established score.
export function ratingSummary(space) {
  const count = Number(space?.reviews ?? space?.ratingCount ?? 0);
  const average = Number(space?.rating ?? space?.averageRating ?? 0);
  if (!Number.isFinite(count) || count <= 0) return { kind: 'none', label: 'No ratings yet' };
  if (count < MIN_RATINGS_FOR_RANK) return { kind: 'new', label: `New · ${count} rating${count === 1 ? '' : 's'}` };
  return { kind: 'established', label: `${Number.isFinite(average) ? average.toFixed(1) : '–'} (${count} ratings)` };
}

function asKobo(value, label = 'Amount') {
  let amount;
  try { amount = BigInt(value); }
  catch { throw new TypeError(`${label} must be an integer number of kobo.`); }
  if (amount < 0n) throw new RangeError(`${label} cannot be negative.`);
  return amount;
}

export function calculateCommissionKobo(baseAmountKobo) {
  const base = asKobo(baseAmountKobo, 'Booking base');
  // Round half up to the nearest kobo using integer arithmetic. The rate is fixed by platform policy.
  return (base * BigInt(PLATFORM_COMMISSION_BPS) + 5_000n) / 10_000n;
}

export function calculateHostShareKobo(baseAmountKobo) {
  const base = asKobo(baseAmountKobo, 'Booking base');
  return base - calculateCommissionKobo(base);
}

// Booking base = hourly rate (per person, per hour) x hours x crew size.
// Owner decision 2026-10-16: every person pays the hourly rate. This is a client-side estimate only;
// the database function request_booking_request is authoritative.
function positiveInteger(value, label) {
  if (typeof value === 'bigint') {
    if (value < 1n) throw new RangeError(`${label} must be at least 1.`);
    return value;
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError(`${label} must be a whole number.`);
  if (value < 1) throw new RangeError(`${label} must be at least 1.`);
  return BigInt(value);
}

export function calculateBookingBaseKobo({ hourlyRateKobo, hours, crewSize }) {
  const rate = positiveInteger(hourlyRateKobo, 'Hourly rate');
  const hourCount = positiveInteger(hours, 'Hours');
  const crew = positiveInteger(crewSize, 'Crew size');
  return rate * hourCount * crew;
}

export function calculateCheckoutKobo(baseAmountKobo, approvedCreatorFeeKobo = 0) {
  const base = asKobo(baseAmountKobo, 'Booking base');
  const fee = asKobo(approvedCreatorFeeKobo, 'Creator fee');
  return base + fee;
}

export function parseNairaToKobo(value) {
  const match = String(value).trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw new TypeError('Enter a valid NGN amount with at most two decimal places.');
  const kobo = BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0') || '0');
  if (kobo > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Amount is too large.');
  return kobo;
}

export const bookingTransitions = Object.freeze({
  request_pending: ['accepted_awaiting_payment', 'declined', 'expired', 'cancelled'],
  accepted_awaiting_payment: ['payment_pending', 'expired', 'cancelled'],
  payment_pending: ['confirmed', 'expired', 'cancelled'],
  confirmed: ['checked_in', 'cancelled', 'disputed'],
  checked_in: ['completion_pending', 'disputed'],
  completion_pending: ['completed', 'disputed'],
  completed: ['disputed'],
  declined: [], expired: [], cancelled: [], disputed: ['completed', 'cancelled'],
});

export function canTransitionBooking(current, next) {
  return bookingTransitions[current]?.includes(next) ?? false;
}

export function assertBookingTransition(current, next) {
  if (!canTransitionBooking(current, next)) throw new Error(`Invalid booking transition: ${current} → ${next}`);
}

export function isValidBookingInterval(startAt, endAt) {
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  return Number.isFinite(start) && Number.isFinite(end) && start < end;
}

export function assessTimeSlot({ date, startTime, durationHours, openingHours = [], busySlots = [], blockedIntervals = [], now = Date.now() }) {
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(String(date));
  const timeMatch = String(startTime).match(/^(\d{2}):(\d{2})$/);
  if (!validDate || !timeMatch || !Number.isInteger(Number(durationHours)) || durationHours < 1 || durationHours > 24) {
    return { available: false, reason: 'Choose a valid date, start time and whole-hour duration.' };
  }
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const startMinute = hour * 60 + minute;
  const endMinute = startMinute + durationHours * 60;
  if (hour > 23 || minute > 59 || minute % 60 !== 0) return { available: false, reason: 'Start time must be on a whole hour.' };
  if (endMinute > 24 * 60) return { available: false, reason: 'Bookings cannot cross into the next calendar day.' };
  const start = Date.parse(`${date}T${startTime}:00+01:00`);
  if (!Number.isFinite(start) || new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date(start)) !== date) {
    return { available: false, reason: 'Choose a valid calendar date.' };
  }
  if (start <= now) return { available: false, reason: 'Choose a future start time.' };
  const end = start + durationHours * 60 * 60 * 1000;
  const timeMinutes = (value) => {
    const match = String(value).match(/^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
  };
  const withinHours = openingHours.some((rule) => {
    const opens = timeMinutes(rule.opens_at);
    const closes = timeMinutes(rule.closes_at);
    return Number.isFinite(opens) && Number.isFinite(closes) && startMinute >= opens && endMinute <= closes;
  });
  if (!withinHours) return { available: false, reason: 'This time is outside the host’s published availability.' };
  const overlaps = (item) => {
    const busyStart = Date.parse(item.starts_at);
    const busyEnd = Date.parse(item.ends_at);
    return Number.isFinite(busyStart) && Number.isFinite(busyEnd) && busyStart < end && start < busyEnd;
  };
  if (busySlots.some(overlaps)) return { available: false, reason: 'This time overlaps an existing booking.' };
  if (blockedIntervals.some(overlaps)) return { available: false, reason: 'This time is blocked by the host.' };
  return { available: true, reason: 'This time appears open; the server will recheck it when you request.' };
}
