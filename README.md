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

## API and operational states

- `GET /api/listings` and `/api/listings/:slug` use the public approved-listing view and private, short-lived photo URLs.
- Booking requests default to host approval. The server validates weekly availability and exclusion constraints; the browser never confirms payment.
- Payment initialization is disabled unless provider credentials, approved policies and database settings are configured. A signed provider webhook updates payment state idempotently. Late success is recorded for manual review and never silently confirms an expired booking.
- OTPs are random, booking-specific, returned once, HMAC-hashed in the database, expiring, window-limited and rate-limited. Check-in does not release payout.
- Completion, disputes, payment and payout are distinct states. Disputes hold payout. The scheduled task only expires stale requests and marks eligible payouts; it does not transfer money or claim escrow.
- Admin reviews/dispute decisions are server-side and audited. Refund/payout provider actions remain manual until real integrations and operational controls are approved.
- Contact notification mail is optional; the contact request is saved before any configured email attempt. The recipient is read from `CONTACT_NOTIFICATION_TO`.

## Vercel and owner launch tasks

Configure the project root as the repository root, `npm run build`, and `dist` as output. Set public Supabase URL/anon key only in `VITE_` variables; set service-role, payment, cron, OTP HMAC and mail secrets server-side only. Configure Vercel Cron for `/api/cron/marketplace-maintenance` and set a high-entropy `CRON_SECRET`.

A real launch still needs owner-controlled database/auth/storage and RLS review, approved merchant/payout accounts, real approved inventory, legal review of draft terms/privacy/cancellation policies, email and domain configuration, support/admin operations, incident/retention decisions, and end-to-end test transactions with reconciliation. No live payment, escrow, payout, verification, support hours, office address, domain ownership or traction is claimed by this code.
