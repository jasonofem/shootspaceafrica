# ShootSpace Africa

A responsive ShootSpace Africa marketplace implementation that preserves the existing dark/orange visual language and uses the supplied interface as its starting point. Public discovery, host submissions, booking requests, payment states and operations dashboards are designed around Supabase-backed records. Fictional design fixtures are development-only, clearly labelled, and are not included in the production bundle.

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Without Supabase client configuration, Vite development mode may show labelled, non-bookable design fixtures. Authentication, booking, uploads and dashboards still require a configured Supabase project. Production builds do not include the fixture module or its images.

## Verification

```bash
npm test
npm run build
```

The SQL files use the Supabase platform roles, `auth` schema and `storage` schema. A PostgreSQL parser check is useful for syntax, but is not a substitute for applying the migrations to a fresh Supabase project and exercising RLS, Storage, Auth, payment webhooks and cron behaviour with test accounts.

## Supabase setup

1. Create a dedicated Supabase project and configure Auth email confirmation, redirect allowlists, abuse protections and account recovery.
2. Review and apply `supabase/migrations/20261011000000_initial_marketplace.sql` and `supabase/migrations/20261011001000_operations_storage_and_settings.sql` in order.
3. Test every table/view/RPC policy using anonymous, creator, host, admin and service-role contexts. Verify private listing addresses, verification documents, dispute evidence, OTP hashes and provider metadata are not public.
4. Seed only the amenity catalogue included in the migration. Do not seed fictional inventory, reviews, users, bookings or dashboard values into staging/production.
5. Create the first administrator manually in an owner-controlled SQL session after the user has registered; never grant admin from signup metadata or a public API.
6. Configure `platform_settings` only after the owner approves terms and operating policy. `commission_bps` is constrained to 1500 (15%); host share is 85% of booking base. Creator fees default to zero and require explicit owner approval.
7. Upload and approve genuine host inventory, photos and host records before opening public discovery.
8. The notifications bell reads and marks notifications directly from the browser, with no API function (the Hobby plan allows at most 12). Reading works after the migrations above. Marking as read needs one extra column permission, because the migrations grant `select` on `public.notifications` and no `update`. Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query → Run) as the project owner:

   ```sql
   grant update (read_at) on public.notifications to authenticated;
   ```

   Row-level security (`notifications_owner_update`) still limits every write to the caller's own rows, and this grants only the `read_at` column. Until it is applied, the bell, the unread badge and the notifications list all work, and marking as read reports that it is not switched on yet.

## API and operational states

- `GET /api/listings` and `/api/listings/:slug` use the public approved-listing view and private, short-lived photo URLs.
- Booking requests default to host approval. The server validates weekly availability and exclusion constraints; the browser never confirms payment.
- Payment initialization is disabled unless provider credentials, approved policies and database settings are configured. A signed provider webhook updates payment state idempotently. Late success is recorded for manual review and never silently confirms an expired booking.
- OTPs are random, booking-specific, returned once, HMAC-hashed in the database, expiring, window-limited and rate-limited. Check-in does not release payout.
- Completion, disputes, payment and payout are distinct states. Disputes hold payout. The scheduled task only expires stale requests and marks eligible payouts; it does not transfer money or claim escrow.
- Admin reviews/dispute decisions are server-side and audited. Refund/payout provider actions remain manual until real integrations and operational controls are approved.
- Contact notification mail is optional; the contact request is saved before any configured email attempt. The recipient is read from `CONTACT_NOTIFICATION_TO`.
- These URLs are grouped into 9 Vercel functions for the Hobby plan; the paths, payloads and responses are unchanged. See “Grouped API functions” below.

## Grouped API functions (Vercel Hobby 12-function limit)

Vercel Hobby allows at most 12 Serverless Functions per deployment. The public API is therefore grouped into **9 functions**, and every public URL, request shape and response shape is unchanged — the browser code in `src/` was not modified.

| Function | Public URLs it serves | Route keys |
| --- | --- | --- |
| `api/bookings.js` | `/api/bookings/request`, `/api/bookings/respond`, `/api/bookings/cancel`, `/api/bookings/completion`, `/api/bookings/otp`, `/api/bookings/disputes`, `/api/bookings/dispute-evidence`, `/api/bookings/:id`, `/api/my-bookings` | `bookings-*` |
| `api/listings.js` | `/api/listings` (default route), `/api/listings/:slug` | `listings-index`, `listings-detail` |
| `api/platform.js` | `/api/amenities`, `/api/availability`, `/api/reviews`, `/api/settings` | `platform-*` |
| `api/account.js` | `/api/me`, `/api/dashboard`, `/api/favorites`, `/api/contact` | `account-*` |
| `api/host.js` | `/api/host/onboarding`, `/api/host/verification-document`, `/api/host/listings`, `/api/host/listings/photo`, `/api/host/listings/submit` | `host-*` |
| `api/admin.js` | `/api/admin/listings/review`, `/api/admin/hosts/review`, `/api/admin/disputes/resolve` | `admin-*` |
| `api/payments.js` | `/api/payments/initialize`, `/api/payments/status` | `payments-*` |
| `api/webhooks/paystack.js` | `/api/webhooks/paystack` (unchanged URL, raw-body signature check) | – |
| `api/cron/marketplace-maintenance.js` | `/api/cron/marketplace-maintenance` (unchanged URL, Vercel cron `0 0 * * *`) | – |

How it works: handler code lives in `api/_lib/endpoints/*.js` (files under `_lib` are helpers, not functions), each thin function file dispatches with `createDispatcher()` from `api/_lib/routes.js`, and `vercel.json` `rewrites` map every public URL to its grouped function with the route key in the `route` query parameter. Rewrites run only after the filesystem misses, so their own query parameters are merged with the caller's (`?listingId=`, `?role=`, `?reference=`, `?amenities=` …), and `POST` bodies, `Authorization` headers, status codes, error messages and cache headers are passed through untouched. `/api/listings`, `/api/webhooks/paystack` and `/api/cron/marketplace-maintenance` are served directly by their function files and need no rewrite.

Adding or changing an endpoint: add the handler to the matching module in `api/_lib/endpoints/`, register the route key in that module's route table, and add the `vercel.json` rewrite. `npm test` fails if a frontend `/api/` call has no rewrite, if a rewrite points at a missing route key, if a route key is unreachable, if the SPA rewrite or the cron schedule changed, or if `api/` grows past 12 function files. Verify with `find api -name '*.js' -not -path '*/_lib/*' | wc -l`.

No environment variable was added, renamed or removed by this grouping. Server-side secrets stay server-side: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OTP_HMAC_SECRET`, `CONTACT_RATE_LIMIT_SECRET`, `CRON_SECRET`, `PAYMENT_PROVIDER`, `PAYSTACK_SECRET_KEY`, `PAYMENT_RETURN_URL`, `PAYMENT_ENABLED`, `OTP_TTL_MINUTES` (required for check-in codes: whole minutes, 1–360) (optional: `CONTACT_NOTIFICATION_TO`, `RESEND_API_KEY`, `MAIL_FROM`). Browser-visible values stay `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

If the Vercel project is deleted and re-imported, the site gets a new address. Update `PAYMENT_RETURN_URL` (`https://<site>/booking-confirmed`), the Paystack webhook URL (`https://<site>/api/webhooks/paystack`), and the Supabase Auth Site URL and Redirect URLs to the new address.

## Vercel and owner launch tasks

Configure the project root as the repository root, `npm run build`, and `dist` as output. Set public Supabase URL/anon key only in `VITE_` variables; set service-role, payment, cron, OTP HMAC and mail secrets server-side only. Configure Vercel Cron for `/api/cron/marketplace-maintenance` and set a high-entropy `CRON_SECRET`. There is deliberately no environment flag for booking or cancellation-policy approval: those gates are in `public.platform_settings`. Payments require both the database setting and server-side `PAYMENT_ENABLED=true`; leave them disabled until staging tests, policy approval and reconciliation are complete.

### Check-in (OTP) setup

Check-in codes need three settings. If any is missing, the check-in room says so instead of issuing codes:

1. **Vercel environment variable** `OTP_HMAC_SECRET` — at least 32 random characters (server-only). Already set if the site issues anything past "Secure check-in codes are not configured yet."
2. **Vercel environment variable** `OTP_TTL_MINUTES` — a whole number of minutes from 1 to 360 (for example `10`). Without it, "Generate a creator check-in code" answers *"Check-in codes are not set up yet…"*. After adding or changing it, redeploy — environment variables are read at deploy time.
3. **Database check-in window** — run once in the Supabase SQL editor (use the same minutes as `OTP_TTL_MINUTES`):

   ```sql
   update public.platform_settings
   set otp_ttl_minutes = 10,
       otp_window_before_minutes = 120,
       otp_window_after_minutes = 120
   where id = true;
   ```

Codes can only be created inside the check-in window: from `otp_window_before_minutes` before the booking starts until `otp_window_after_minutes` after it ends. That is deliberate — a booking a week away cannot get a code today. To rehearse with a future booking, temporarily widen the window (for example `otp_window_before_minutes = 20160` for 14 days) and set it back afterwards, or use a test booking that starts within the window. Codes expire after `OTP_TTL_MINUTES` minutes, one code per minute and five per hour per booking, and only the booking's creator can issue one and only its host can verify it.

A real launch still needs owner-controlled database/auth/storage and RLS review, approved merchant/payout accounts, real approved inventory, legal review of draft terms/privacy/cancellation policies, email and domain configuration, support/admin operations, incident/retention decisions, and end-to-end test transactions with reconciliation. No live payment, escrow, payout, verification, support hours, office address, domain ownership or traction is claimed by this code.

## Private test deployment on Vercel Hobby (test-only limitation)

`vercel.json` schedules `/api/cron/marketplace-maintenance` at `0 0 * * *` (once daily, 00:00 UTC). Vercel Hobby only accepts cron schedules that run at most once per day, and on Hobby the run may start at any point within that UTC hour. The earlier `*/15 * * * *` schedule was rejected at deploy time for this reason.

This daily schedule is acceptable only for a private, non-commercial test with no real money and no real users relying on booking or payout status. It is **not suitable for production**:

- **Stale requests and payment windows stay visible for up to about a day.** `expire_stale_bookings` is what moves `request_pending`, `accepted_awaiting_payment` and `payment_pending` rows to `expired` (and marks `payment_status` as `failed`). Until it runs, a lapsed booking can still show its old status in dashboards and lists. The database still refuses late actions: accepting an expired request (`request_not_open`), starting payment after the window (`booking_not_payable`), and a late provider success is recorded but not confirmed or paid out. Testers should therefore treat displayed statuses as possibly stale.
- **Payout eligibility is delayed, not accelerated.** `release_mature_payouts` marks payouts `eligible` after `payout_delay_hours` and only when no open dispute exists. A daily run can make a payout eligible up to about a day later than the 15-minute schedule would. This delay is conservative, but eligibility still does not mean money has moved.
- **Nothing is transferred.** The job reports `transfersSent: 0`. There are no automatic payouts, no escrow and no refunds in this code.

For production, run maintenance more often than daily. The preferred free option is the Supabase `pg_cron` job in `supabase/migrations/20261016000000_pg_cron_maintenance.sql`, which runs every 15 minutes inside the database and needs no secret. Enable the `pg_cron` extension in Supabase (Database → Extensions) before applying that migration. The Vercel daily cron is then only a backup. Keep payments disabled until staging, policy approval and reconciliation are complete.

Vercel Hobby is not appropriate for commercial production. Keep `PAYMENT_ENABLED` unset or `false`, do not put service-role, payment, `CRON_SECRET` or other secret values in the repository or in `VITE_` variables, and do not describe this test as escrow, automated payouts or live commerce.
