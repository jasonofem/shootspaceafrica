export function methodNotAllowed(res, allowed) {
  res.setHeader('Allow', allowed.join(', '));
  return res.status(405).json({ error: 'Method not allowed.' });
}

export function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : typeof req.body === 'string' ? req.body : '';
  if (raw) {
    try { return Promise.resolve(JSON.parse(raw)); } catch { return Promise.reject(new Error('Invalid JSON body.')); }
  }
  return new Promise((resolve, reject) => {
    let content = '';
    req.on('data', (chunk) => {
      content += chunk;
      if (content.length > 1_000_000) reject(new Error('Request body too large.'));
    });
    req.on('end', () => {
      if (!content) return resolve({});
      try { resolve(JSON.parse(content)); } catch { reject(new Error('Invalid JSON body.')); }
    });
    req.on('error', reject);
  });
}

export function sendError(res, error, fallback = 'Request could not be completed.') {
  const message = error?.message || fallback;
  const code = error?.code || '';
  const status = code === '28000' ? 401
    : code === '42501' ? 403
      : code === 'P0002' ? 404
        : code === '23P01' ? 409
          : ['22023', '23514'].includes(code) ? 400
            : code === '55000' ? 409
              : error?.statusCode || 500;
  return res.status(status).json({ error: publicErrorMessage(message, status) });
}

function publicErrorMessage(message, status) {
  const known = new Set([
    'authentication_required', 'creator_role_required', 'booking_not_enabled', 'listing_not_bookable',
    'instant_booking_not_enabled_for_pilot', 'invalid_booking_interval', 'booking_must_use_whole_hours',
    'outside_booking_hour_limits', 'crew_capacity_exceeded', 'invalid_production_type',
    'outside_host_availability', 'availability_blocked', 'time_slot_unavailable', 'request_not_open',
    'payments_not_enabled', 'unsupported_payment_provider', 'booking_not_payable',
    'otp_window_not_configured', 'booking_not_eligible_for_otp', 'invalid_otp_expiry',
    'otp_issue_rate_limited', 'otp_issue_hourly_limit_reached', 'outside_checkin_window', 'booking_not_ready_for_completion', 'booking_not_ready_to_complete',
    'open_dispute_holds_completion', 'booking_not_disputable', 'host_terms_required',
    'host_role_required', 'admin_role_required', 'listing_review_requirements_not_met',
  ]);
  if (known.has(message)) return message.replaceAll('_', ' ');
  if (status >= 500) return 'The service is not configured or is temporarily unavailable. Please try again later.';
  return message;
}
