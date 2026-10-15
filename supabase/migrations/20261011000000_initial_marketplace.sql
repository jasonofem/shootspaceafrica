-- ShootSpace Africa production foundation. No production demo data is seeded.
-- Apply to a dedicated Supabase project after reviewing access and storage policies.
create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  phone text,
  account_status text not null default 'active' check (account_status in ('active','suspended','deletion_pending')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('creator','host','admin','support')),
  assigned_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.host_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  public_display_name text not null default '',
  bio text not null default '',
  verification_status text not null default 'not_started' check (verification_status in ('not_started','pending','approved','needs_changes','rejected','suspended')),
  verification_submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  review_reason text,
  host_terms_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.host_verification_events (
  id uuid primary key default gen_random_uuid(),
  host_user_id uuid not null references public.host_profiles(user_id) on delete cascade,
  actor_id uuid references auth.users(id),
  from_status text,
  to_status text not null,
  reason text,
  created_at timestamptz not null default now()
);

create table public.host_verification_documents (
  id uuid primary key default gen_random_uuid(),
  host_user_id uuid not null references public.host_profiles(user_id) on delete cascade,
  storage_path text not null unique,
  document_type text not null,
  review_status text not null default 'pending' check (review_status in ('pending','approved','rejected')),
  uploaded_by uuid not null references auth.users(id),
  reviewed_by uuid references auth.users(id),
  review_reason text,
  created_at timestamptz not null default now()
);

create table public.amenities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null unique,
  is_active boolean not null default true
);
insert into public.amenities(slug,name) values
  ('generator','Generator'),('soundproof-room','Soundproof Room'),('changing-room','Changing Room'),
  ('parking','Parking'),('high-ceilings','High Ceilings'),('power-backup','Power Backup'),
  ('natural-lighting','Natural Lighting'),('wifi','WiFi'),('kitchen','Kitchen'),
  ('garden','Garden'),('loading-bay','Loading Bay')
on conflict (slug) do nothing;

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete restrict,
  slug text not null unique,
  title text not null check (char_length(title) between 4 and 120),
  category text not null,
  description text not null default '',
  city text not null,
  neighbourhood text not null,
  public_location text not null default '',
  exact_address text not null,
  hourly_rate_kobo bigint not null check (hourly_rate_kobo between 1 and 375000000000000),
  currency text not null default 'NGN' check (currency = 'NGN'),
  min_hours smallint not null default 1 check (min_hours between 1 and 24),
  crew_capacity smallint not null check (crew_capacity between 1 and 500),
  booking_mode text not null default 'request' check (booking_mode in ('request','instant')),
  house_rules text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft','submitted','published','rejected','paused','changes_requested')),
  moderation_reason text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  submitted_at timestamptz,
  cancellation_policy_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index listings_owner_status_idx on public.listings(owner_id, status);
create index listings_discovery_idx on public.listings(city, category, hourly_rate_kobo) where status = 'published';

create table public.listing_photos (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  storage_path text not null unique,
  sort_order smallint not null default 0,
  is_cover boolean not null default false,
  alt_text text not null default '',
  moderation_status text not null default 'pending' check (moderation_status in ('pending','approved','rejected')),
  source_type text not null default 'host_upload' check (source_type in ('host_upload','licensed_editorial')),
  licence_metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index listing_photos_listing_idx on public.listing_photos(listing_id, sort_order);

create table public.listing_amenities (
  listing_id uuid not null references public.listings(id) on delete cascade,
  amenity_id uuid not null references public.amenities(id) on delete restrict,
  primary key (listing_id, amenity_id)
);

create table public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  opens_at time not null,
  closes_at time not null,
  timezone text not null default 'Africa/Lagos',
  active boolean not null default true,
  check (opens_at < closes_at)
);
create index availability_rules_listing_idx on public.availability_rules(listing_id, weekday) where active;

create table public.availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_blocked boolean not null default true,
  note text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (starts_at < ends_at)
);
create index availability_exceptions_listing_idx on public.availability_exceptions(listing_id, starts_at, ends_at);

create table public.platform_settings (
  id boolean primary key default true check (id),
  commission_bps integer not null default 1500 check (commission_bps = 1500),
  booking_enabled boolean not null default false,
  payment_enabled boolean not null default false,
  cancellation_policy_approved boolean not null default false,
  cancellation_policy_version text,
  cancellation_policy_text text,
  request_expiry_minutes integer check (request_expiry_minutes > 0),
  payment_window_minutes integer check (payment_window_minutes > 0),
  otp_ttl_minutes integer check (otp_ttl_minutes > 0),
  otp_window_before_minutes integer check (otp_window_before_minutes >= 0),
  otp_window_after_minutes integer check (otp_window_after_minutes >= 0),
  payout_delay_hours integer check (payout_delay_hours >= 0),
  creator_fee_bps integer not null default 0 check (creator_fee_bps between 0 and 10000),
  creator_fee_approved boolean not null default false,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
insert into public.platform_settings (id) values (true) on conflict (id) do nothing;

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  public_code text not null unique,
  request_idempotency_key uuid,
  listing_id uuid not null references public.listings(id) on delete restrict,
  listing_title_snapshot text not null default '',
  listing_city_snapshot text not null default '',
  listing_neighbourhood_snapshot text not null default '',
  creator_id uuid not null references public.profiles(id) on delete restrict,
  host_id uuid not null references public.profiles(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  hours smallint not null check (hours between 1 and 24),
  crew_size smallint not null check (crew_size > 0),
  production_type text not null,
  creator_notes text not null default '',
  booking_status text not null default 'request_pending' check (booking_status in ('request_pending','accepted_awaiting_payment','payment_pending','confirmed','checked_in','completion_pending','completed','declined','cancelled','expired','disputed')),
  payment_status text not null default 'not_started' check (payment_status in ('not_started','pending','paid','failed','refund_pending','partially_refunded','refunded')),
  payout_status text not null default 'not_eligible' check (payout_status in ('not_eligible','held','eligible','queued','processing','paid','failed','cancelled')),
  currency text not null default 'NGN' check (currency = 'NGN'),
  hourly_rate_kobo_snapshot bigint not null check (hourly_rate_kobo_snapshot > 0),
  base_amount_kobo bigint not null check (base_amount_kobo > 0),
  creator_fee_kobo bigint not null default 0 check (creator_fee_kobo >= 0),
  creator_fee_bps_snapshot integer not null default 0 check (creator_fee_bps_snapshot between 0 and 10000),
  total_amount_kobo bigint not null check (total_amount_kobo >= 0),
  commission_bps_snapshot integer not null check (commission_bps_snapshot = 1500),
  commission_kobo_snapshot bigint not null check (commission_kobo_snapshot >= 0),
  host_share_kobo_snapshot bigint not null check (host_share_kobo_snapshot >= 0),
  cancellation_policy_snapshot text not null,
  policy_version_snapshot text not null,
  request_expires_at timestamptz,
  payment_expires_at timestamptz,
  completion_submitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at < ends_at),
  check (total_amount_kobo = base_amount_kobo + creator_fee_kobo and total_amount_kobo <= 9000000000000000),
  unique (creator_id, request_idempotency_key),
  exclude using gist (
    listing_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (booking_status in ('request_pending','accepted_awaiting_payment','payment_pending','confirmed','checked_in','completion_pending','disputed'))
);
create index bookings_creator_idx on public.bookings(creator_id, created_at desc);
create index bookings_host_idx on public.bookings(host_id, starts_at);
create index bookings_status_expiry_idx on public.bookings(booking_status, request_expires_at);

create table public.booking_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  actor_id uuid references auth.users(id),
  event_type text not null,
  from_status text,
  to_status text,
  reason text,
  safe_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index booking_events_timeline_idx on public.booking_events(booking_id, created_at);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  provider text not null,
  provider_reference text not null unique,
  idempotency_key uuid not null unique,
  amount_kobo bigint not null check (amount_kobo > 0),
  verified_amount_kobo bigint,
  currency text not null default 'NGN' check (currency = 'NGN'),
  status text not null default 'pending' check (status in ('pending','paid','failed','refund_pending','partially_refunded','refunded')),
  authorization_url text,
  provider_metadata jsonb not null default '{}'::jsonb,
  initialized_at timestamptz not null default now(),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_booking_idx on public.payments(booking_id, created_at desc);

create table public.payment_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  signature_valid boolean not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  outcome text,
  safe_payload jsonb not null default '{}'::jsonb,
  unique(provider, provider_event_id)
);

create table public.otp_sessions (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  code_hash text not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 10),
  used_at timestamptz,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  check (issued_at < expires_at)
);
create index otp_sessions_booking_idx on public.otp_sessions(booking_id, issued_at desc);

create table public.payout_ledger (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid references public.bookings(id) on delete restrict,
  host_id uuid references public.profiles(id) on delete restrict,
  entry_type text not null check (entry_type in ('booking_base','platform_commission','host_payable','creator_fee','refund','adjustment','payout')),
  amount_kobo bigint not null,
  currency text not null default 'NGN' check (currency = 'NGN'),
  external_reference text,
  safe_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index payout_ledger_host_idx on public.payout_ledger(host_id, created_at desc);

create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  host_id uuid not null references public.profiles(id) on delete restrict,
  amount_kobo bigint not null check (amount_kobo > 0),
  provider text,
  provider_reference text unique,
  status text not null default 'held' check (status in ('not_eligible','held','eligible','queued','processing','paid','failed','cancelled')),
  initiated_at timestamptz,
  confirmed_at timestamptz,
  failure_reason text,
  audit_actor uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booking_id)
);

create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  opened_by uuid not null references public.profiles(id) on delete restrict,
  dispute_type text not null,
  description text not null check (char_length(description) between 10 and 10000),
  status text not null default 'open' check (status in ('open','under_review','request_more_evidence','resolved','closed')),
  assigned_admin uuid references auth.users(id),
  resolution text,
  resolution_reason text,
  refund_amount_kobo bigint not null default 0 check (refund_amount_kobo >= 0),
  payout_decision text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index disputes_status_idx on public.disputes(status, created_at);

create table public.dispute_evidence (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references public.disputes(id) on delete cascade,
  storage_path text not null unique,
  uploaded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  reviewer_id uuid not null references public.profiles(id) on delete restrict,
  listing_id uuid not null references public.listings(id) on delete restrict,
  rating smallint not null check (rating between 1 and 5),
  body text not null default '',
  moderation_status text not null default 'pending' check (moderation_status in ('pending','published','rejected')),
  created_at timestamptz not null default now(),
  unique (booking_id, reviewer_id)
);

create table public.favorites (
  creator_id uuid not null references public.profiles(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (creator_id, listing_id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  delivery_status text not null default 'queued' check (delivery_status in ('queued','sent','failed')),
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_recipient_idx on public.notifications(recipient_id, created_at desc);

create table public.contact_requests (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  phone text,
  subject text not null,
  message text not null check (char_length(message) between 10 and 10000),
  request_category text not null default 'general',
  status text not null default 'new' check (status in ('new','in_progress','resolved','spam')),
  ip_fingerprint text,
  created_at timestamptz not null default now()
);
create index contact_requests_rate_idx on public.contact_requests(ip_fingerprint, created_at desc);

create table public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id),
  action text not null,
  target_table text not null,
  target_id text not null,
  reason text not null,
  safe_before_after jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index admin_audit_target_idx on public.admin_audit_log(target_table, target_id, created_at desc);

-- Do not inherit broad Supabase default privileges: grant only the reads each API path requires.
revoke all on public.profiles,public.user_roles,public.host_profiles,public.host_verification_events,public.host_verification_documents,
  public.amenities,public.listings,public.listing_photos,public.listing_amenities,public.availability_rules,public.availability_exceptions,
  public.platform_settings,public.bookings,public.booking_events,public.payments,public.payment_webhook_events,public.otp_sessions,
  public.payout_ledger,public.payouts,public.disputes,public.dispute_evidence,public.reviews,public.favorites,public.notifications,
  public.contact_requests,public.admin_audit_log from anon,authenticated;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger hosts_touch before update on public.host_profiles for each row execute function public.touch_updated_at();
create trigger listings_touch before update on public.listings for each row execute function public.touch_updated_at();
create trigger bookings_touch before update on public.bookings for each row execute function public.touch_updated_at();
create trigger payments_touch before update on public.payments for each row execute function public.touch_updated_at();
create trigger payouts_touch before update on public.payouts for each row execute function public.touch_updated_at();
create trigger disputes_touch before update on public.disputes for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, display_name) values (new.id, coalesce(new.raw_user_meta_data->>'display_name','')) on conflict (id) do nothing;
  insert into public.user_roles(user_id, role) values (new.id, 'creator') on conflict do nothing;
  return new;
end;
$$;
create trigger auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'admin');
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create or replace function public.is_listing_public(p_listing_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.listings l join public.host_profiles h on h.user_id=l.owner_id where l.id=p_listing_id and l.status='published' and h.verification_status='approved');
$$;
revoke all on function public.is_listing_public(uuid) from public;
grant execute on function public.is_listing_public(uuid) to anon,authenticated;

-- Public view intentionally omits exact_address, owner IDs, bank data and private contact fields.
create or replace view public.public_listings as
select
  l.id, l.slug, l.title, l.category, l.description, l.city, l.neighbourhood,
  l.public_location, l.hourly_rate_kobo, l.currency, l.min_hours, l.crew_capacity,
  l.booking_mode, l.house_rules, l.status, l.created_at,
  'approved'::text as host_verification_status,
  coalesce((select array_agg(a.name order by a.name) from public.listing_amenities la join public.amenities a on a.id = la.amenity_id where la.listing_id = l.id and a.is_active), '{}'::text[]) as amenities,
  coalesce((select jsonb_agg(jsonb_build_object('storage_path',p.storage_path,'sort_order',p.sort_order,'is_cover',p.is_cover,'alt_text',p.alt_text) order by p.sort_order) from public.listing_photos p where p.listing_id = l.id and p.moderation_status = 'approved'), '[]'::jsonb) as photos,
  (select round(avg(r.rating)::numeric, 1) from public.reviews r where r.listing_id = l.id and r.moderation_status = 'published') as average_rating,
  (select count(*)::integer from public.reviews r where r.listing_id = l.id and r.moderation_status = 'published') as review_count
from public.listings l
join public.host_profiles h on h.user_id = l.owner_id
where l.status = 'published' and h.verification_status = 'approved'
  and exists (select 1 from public.listing_photos p where p.listing_id = l.id and p.moderation_status = 'approved');
revoke all on public.public_listings from public;
grant select on public.public_listings to anon, authenticated;

-- Initial safe policies: direct reads/writes are limited; privileged lifecycle changes use RPC/server functions.
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.host_profiles enable row level security;
alter table public.host_verification_events enable row level security;
alter table public.host_verification_documents enable row level security;
alter table public.amenities enable row level security;
alter table public.listings enable row level security;
alter table public.listing_photos enable row level security;
alter table public.listing_amenities enable row level security;
alter table public.availability_rules enable row level security;
alter table public.availability_exceptions enable row level security;
alter table public.platform_settings enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_events enable row level security;
alter table public.payments enable row level security;
alter table public.payment_webhook_events enable row level security;
alter table public.otp_sessions enable row level security;
alter table public.payout_ledger enable row level security;
alter table public.payouts enable row level security;
alter table public.disputes enable row level security;
alter table public.dispute_evidence enable row level security;
alter table public.reviews enable row level security;
alter table public.favorites enable row level security;
alter table public.notifications enable row level security;
alter table public.contact_requests enable row level security;
alter table public.admin_audit_log enable row level security;

create policy profiles_select_self_or_admin on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy profiles_update_self on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy roles_read_self_or_admin on public.user_roles for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy host_profile_read_owner_admin on public.host_profiles for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy host_profile_insert_self on public.host_profiles for insert to authenticated with check (user_id = auth.uid() and verification_status in ('not_started','pending') and reviewed_at is null and reviewed_by is null);
create policy host_profile_update_self_pending on public.host_profiles for update to authenticated using (user_id = auth.uid() and verification_status in ('not_started','needs_changes')) with check (user_id = auth.uid() and verification_status in ('not_started','pending','needs_changes'));
create policy host_events_read_owner_admin on public.host_verification_events for select to authenticated using (host_user_id = auth.uid() or public.is_admin());
create policy host_documents_read_owner_admin on public.host_verification_documents for select to authenticated using (host_user_id = auth.uid() or public.is_admin());
create policy host_documents_insert_self on public.host_verification_documents for insert to authenticated with check (uploaded_by = auth.uid() and host_user_id = auth.uid() and review_status = 'pending');
create policy amenities_public_active on public.amenities for select to anon, authenticated using (is_active);
create policy listings_owner_admin_read on public.listings for select to authenticated using (owner_id = auth.uid() or public.is_admin());
create policy listings_owner_insert_draft on public.listings for insert to authenticated with check (owner_id = auth.uid() and status = 'draft' and exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'host'));
create policy listings_owner_update_draft on public.listings for update to authenticated using (owner_id = auth.uid() and status in ('draft','changes_requested')) with check (owner_id = auth.uid() and status in ('draft','submitted','changes_requested'));
create policy listing_photos_owner_admin on public.listing_photos for select to authenticated using (public.is_admin() or exists (select 1 from public.listings l where l.id = listing_id and l.owner_id = auth.uid()));
create policy listing_photos_owner_insert on public.listing_photos for insert to authenticated with check (created_by = auth.uid() and exists (select 1 from public.listings l where l.id = listing_id and l.owner_id = auth.uid() and l.status in ('draft','changes_requested')));
create policy listing_amenities_owner_read on public.listing_amenities for select to authenticated using (exists (select 1 from public.listings l where l.id = listing_id and (l.owner_id = auth.uid() or public.is_admin())));
create policy listing_amenities_owner_write on public.listing_amenities for all to authenticated using (exists (select 1 from public.listings l where l.id = listing_id and l.owner_id = auth.uid() and l.status in ('draft','changes_requested'))) with check (exists (select 1 from public.listings l where l.id = listing_id and l.owner_id = auth.uid() and l.status in ('draft','changes_requested')));
create policy availability_owner_all on public.availability_rules for all to authenticated using (exists (select 1 from public.listings l where l.id = listing_id and (l.owner_id = auth.uid() or public.is_admin()))) with check (exists (select 1 from public.listings l where l.id = listing_id and (l.owner_id = auth.uid() or public.is_admin())));
create policy exceptions_owner_all on public.availability_exceptions for all to authenticated using (created_by = auth.uid() or public.is_admin()) with check (created_by = auth.uid() and exists (select 1 from public.listings l where l.id = listing_id and l.owner_id = auth.uid()));
create policy settings_admin_read on public.platform_settings for select to authenticated using (public.is_admin());
create policy bookings_participant_admin_read on public.bookings for select to authenticated using (creator_id = auth.uid() or host_id = auth.uid() or public.is_admin());
create policy events_participant_admin_read on public.booking_events for select to authenticated using (public.is_admin() or exists (select 1 from public.bookings b where b.id = booking_id and (b.creator_id = auth.uid() or b.host_id = auth.uid())));
create policy payments_participant_read on public.payments for select to authenticated using (public.is_admin() or exists (select 1 from public.bookings b where b.id = booking_id and (b.creator_id = auth.uid() or b.host_id = auth.uid())));
create policy webhooks_admin_read on public.payment_webhook_events for select to authenticated using (public.is_admin());
create policy otp_participant_no_read on public.otp_sessions for select to authenticated using (false);
create policy ledger_owner_admin_read on public.payout_ledger for select to authenticated using (host_id = auth.uid() or public.is_admin());
create policy payouts_owner_admin_read on public.payouts for select to authenticated using (host_id = auth.uid() or public.is_admin());
create policy disputes_participant_admin_read on public.disputes for select to authenticated using (opened_by = auth.uid() or public.is_admin() or exists (select 1 from public.bookings b where b.id = booking_id and b.host_id = auth.uid()));
create policy evidence_private_participant on public.dispute_evidence for select to authenticated using (uploaded_by = auth.uid() or public.is_admin() or exists (select 1 from public.disputes d where d.id = dispute_id and d.opened_by = auth.uid()));
create policy reviews_public_published on public.reviews for select to anon, authenticated using (moderation_status='published' and public.is_listing_public(listing_id));
create policy reviews_creator_insert_completed on public.reviews for insert to authenticated with check (reviewer_id = auth.uid() and exists (select 1 from public.bookings b where b.id = booking_id and b.creator_id = auth.uid() and b.listing_id = listing_id and b.booking_status = 'completed'));
create policy favorites_owner_all on public.favorites for all to authenticated using (creator_id = auth.uid()) with check (creator_id = auth.uid());
create policy notifications_owner_read_update on public.notifications for select to authenticated using (recipient_id = auth.uid());
create policy notifications_owner_update on public.notifications for update to authenticated using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
create policy audit_admin_read on public.admin_audit_log for select to authenticated using (public.is_admin());

-- Public data access is only through the safe view, not the base listings table.
revoke all on public.listings, public.listing_photos, public.host_profiles, public.host_verification_events,
  public.bookings, public.booking_events, public.payments, public.payment_webhook_events,
  public.otp_sessions, public.payout_ledger, public.payouts, public.disputes, public.dispute_evidence,
  public.contact_requests, public.admin_audit_log from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name,phone) on public.profiles to authenticated;
grant select on public.user_roles, public.host_profiles, public.host_verification_events, public.host_verification_documents, public.amenities,
  public.listings, public.listing_photos, public.listing_amenities, public.availability_rules, public.availability_exceptions,
  public.platform_settings, public.bookings, public.booking_events, public.payments, public.payout_ledger, public.payouts,
  public.disputes, public.dispute_evidence, public.reviews, public.favorites, public.notifications, public.admin_audit_log to authenticated;
grant select on public.amenities,public.reviews to anon;

create or replace function public.request_booking_request(
  p_listing_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_crew_size smallint,
  p_production_type text,
  p_notes text,
  p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_listing public.listings%rowtype;
  v_settings public.platform_settings%rowtype;
  v_hours integer;
  v_base bigint;
  v_creator_fee bigint;
  v_commission bigint;
  v_code text;
  v_booking public.bookings%rowtype;
  v_local_start timestamp;
  v_local_end timestamp;
begin
  if v_user is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_user and role = 'creator') then raise exception 'creator_role_required' using errcode = '42501'; end if;
  select * into v_settings from public.platform_settings where id = true;
  if not coalesce(v_settings.booking_enabled, false) or not coalesce(v_settings.cancellation_policy_approved, false) then raise exception 'booking_not_enabled' using errcode = '55000'; end if;
  if v_settings.request_expiry_minutes is null or v_settings.cancellation_policy_version is null or nullif(trim(v_settings.cancellation_policy_text),'') is null then raise exception 'booking_policy_not_configured' using errcode = '55000'; end if;
  select l.* into v_listing from public.listings l join public.host_profiles h on h.user_id = l.owner_id where l.id = p_listing_id and l.status = 'published' and h.verification_status = 'approved' for share of l;
  if not found then raise exception 'listing_not_bookable' using errcode = 'P0002'; end if;
  if v_listing.booking_mode <> 'request' then raise exception 'instant_booking_not_enabled_for_pilot' using errcode = '55000'; end if;
  if p_starts_at <= now() or p_ends_at <= p_starts_at then raise exception 'invalid_booking_interval' using errcode = '22023'; end if;
  if mod(extract(epoch from (p_ends_at - p_starts_at))::bigint, 3600) <> 0 then raise exception 'booking_must_use_whole_hours' using errcode = '22023'; end if;
  v_hours := (extract(epoch from (p_ends_at - p_starts_at)) / 3600)::integer;
  if v_hours < v_listing.min_hours or v_hours > 24 then raise exception 'outside_booking_hour_limits' using errcode = '22023'; end if;
  if p_crew_size < 1 or p_crew_size > v_listing.crew_capacity then raise exception 'crew_capacity_exceeded' using errcode = '22023'; end if;
  if p_production_type is null or char_length(trim(p_production_type)) not between 2 and 100 then raise exception 'invalid_production_type' using errcode = '22023'; end if;
  v_local_start := p_starts_at at time zone 'Africa/Lagos';
  v_local_end := p_ends_at at time zone 'Africa/Lagos';
  if (v_local_start::date <> v_local_end::date) or not exists (
    select 1 from public.availability_rules ar
    where ar.listing_id = p_listing_id and ar.active
      and ar.weekday = extract(dow from v_local_start)::smallint
      and v_local_start::time >= ar.opens_at and v_local_end::time <= ar.closes_at
  ) then raise exception 'outside_host_availability' using errcode = '22023'; end if;
  if exists (select 1 from public.availability_exceptions ae where ae.listing_id = p_listing_id and ae.is_blocked and tstzrange(ae.starts_at,ae.ends_at,'[)') && tstzrange(p_starts_at,p_ends_at,'[)')) then raise exception 'availability_blocked' using errcode = '23P01'; end if;
  select * into v_booking from public.bookings where creator_id = v_user and request_idempotency_key = p_idempotency_key;
  if found then return jsonb_build_object('booking_id',v_booking.id,'public_code',v_booking.public_code,'booking_status',v_booking.booking_status,'payment_status',v_booking.payment_status,'total_amount_kobo',v_booking.total_amount_kobo); end if;
  v_base := v_listing.hourly_rate_kobo * v_hours;
  v_creator_fee := case when v_settings.creator_fee_approved then floor((v_base::numeric * v_settings.creator_fee_bps + 5000) / 10000)::bigint else 0 end;
  v_commission := floor((v_base::numeric * v_settings.commission_bps + 5000) / 10000)::bigint;
  v_code := 'SSA-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
  insert into public.bookings(public_code,request_idempotency_key,listing_id,listing_title_snapshot,listing_city_snapshot,listing_neighbourhood_snapshot,creator_id,host_id,starts_at,ends_at,hours,crew_size,production_type,creator_notes,booking_status,payment_status,payout_status,hourly_rate_kobo_snapshot,base_amount_kobo,creator_fee_kobo,creator_fee_bps_snapshot,total_amount_kobo,commission_bps_snapshot,commission_kobo_snapshot,host_share_kobo_snapshot,cancellation_policy_snapshot,policy_version_snapshot,request_expires_at)
  values(v_code,p_idempotency_key,p_listing_id,v_listing.title,v_listing.city,v_listing.neighbourhood,v_user,v_listing.owner_id,p_starts_at,p_ends_at,v_hours,p_crew_size,trim(p_production_type),coalesce(left(p_notes,2000),''),'request_pending','not_started','not_eligible',v_listing.hourly_rate_kobo,v_base,v_creator_fee,case when v_settings.creator_fee_approved then v_settings.creator_fee_bps else 0 end,v_base+v_creator_fee,v_settings.commission_bps,v_commission,v_base-v_commission,v_settings.cancellation_policy_text,v_settings.cancellation_policy_version,now()+make_interval(mins=>v_settings.request_expiry_minutes)) returning * into v_booking;
  insert into public.booking_events(booking_id,actor_id,event_type,to_status,safe_metadata) values(v_booking.id,v_user,'request_created','request_pending',jsonb_build_object('listing_id',p_listing_id));
  insert into public.notifications(recipient_id,event_type,payload) values(v_listing.owner_id,'booking_request_created',jsonb_build_object('booking_id',v_booking.id,'public_code',v_booking.public_code));
  return jsonb_build_object('booking_id',v_booking.id,'public_code',v_booking.public_code,'booking_status',v_booking.booking_status,'payment_status',v_booking.payment_status,'total_amount_kobo',v_booking.total_amount_kobo);
exception when exclusion_violation then raise exception 'time_slot_unavailable' using errcode = '23P01';
end;
$$;
revoke all on function public.request_booking_request(uuid,timestamptz,timestamptz,smallint,text,text,uuid) from public;
grant execute on function public.request_booking_request(uuid,timestamptz,timestamptz,smallint,text,text,uuid) to authenticated;

create or replace function public.respond_to_booking_request(p_booking_id uuid,p_accept boolean,p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_booking public.bookings%rowtype; v_next text; v_payment_window integer;
begin
  if v_user is null then raise exception 'authentication_required' using errcode='28000'; end if;
  select payment_window_minutes into v_payment_window from public.platform_settings where id=true;
  if p_accept and v_payment_window is null then raise exception 'payment_window_not_configured' using errcode='55000'; end if;
  select * into v_booking from public.bookings where id=p_booking_id for update;
  if not found or v_booking.host_id<>v_user then raise exception 'booking_not_found' using errcode='P0002'; end if;
  if v_booking.booking_status<>'request_pending' or v_booking.request_expires_at<=now() then raise exception 'request_not_open' using errcode='55000'; end if;
  v_next := case when p_accept then 'accepted_awaiting_payment' else 'declined' end;
  update public.bookings set booking_status=v_next,payment_expires_at=case when p_accept then now()+make_interval(mins=>v_payment_window) else null end,updated_at=now() where id=p_booking_id;
  insert into public.booking_events(booking_id,actor_id,event_type,from_status,to_status,reason) values(p_booking_id,v_user,case when p_accept then 'request_accepted' else 'request_declined' end,'request_pending',v_next,left(p_reason,1000));
  insert into public.notifications(recipient_id,event_type,payload) values(v_booking.creator_id,case when p_accept then 'booking_request_accepted' else 'booking_request_declined' end,jsonb_build_object('booking_id',p_booking_id,'public_code',v_booking.public_code));
  return jsonb_build_object('booking_id',p_booking_id,'booking_status',v_next);
end;
$$;
revoke all on function public.respond_to_booking_request(uuid,boolean,text) from public;
grant execute on function public.respond_to_booking_request(uuid,boolean,text) to authenticated;

create or replace function public.prepare_booking_payment(p_booking_id uuid,p_provider text,p_provider_reference text,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid:=auth.uid(); v_booking public.bookings%rowtype; v_settings public.platform_settings%rowtype; v_payment public.payments%rowtype;
begin
  if v_user is null then raise exception 'authentication_required' using errcode='28000'; end if;
  select * into v_settings from public.platform_settings where id=true;
  if not v_settings.payment_enabled or not v_settings.booking_enabled or not v_settings.cancellation_policy_approved then raise exception 'payments_not_enabled' using errcode='55000'; end if;
  if p_provider <> 'paystack' then raise exception 'unsupported_payment_provider' using errcode='22023'; end if;
  select * into v_booking from public.bookings where id=p_booking_id and creator_id=v_user for update;
  if not found or v_booking.booking_status not in ('accepted_awaiting_payment','payment_pending') or v_booking.payment_expires_at is null or v_booking.payment_expires_at<=now() then raise exception 'booking_not_payable' using errcode='55000'; end if;
  select * into v_payment from public.payments where booking_id=p_booking_id and status='pending' order by created_at desc limit 1 for update;
  if found then
    if v_payment.authorization_url is null then raise exception 'payment_initialization_pending_manual_reconciliation' using errcode='55000'; end if;
    return jsonb_build_object('payment_id',v_payment.id,'reference',v_payment.provider_reference,'amount_kobo',v_payment.amount_kobo,'status',v_payment.status,'authorization_url',v_payment.authorization_url);
  end if;
  select * into v_payment from public.payments where idempotency_key=p_idempotency_key for update;
  if found then
    if v_payment.booking_id<>p_booking_id then raise exception 'payment_idempotency_key_already_used' using errcode='22023'; end if;
    if v_payment.status='failed' then raise exception 'payment_attempt_failed_new_idempotency_key_required' using errcode='55000'; end if;
    return jsonb_build_object('payment_id',v_payment.id,'reference',v_payment.provider_reference,'amount_kobo',v_payment.amount_kobo,'status',v_payment.status,'authorization_url',v_payment.authorization_url);
  end if;
  insert into public.payments(booking_id,provider,provider_reference,idempotency_key,amount_kobo,currency,status)
  values(p_booking_id,p_provider,p_provider_reference,p_idempotency_key,v_booking.total_amount_kobo,'NGN','pending') returning * into v_payment;
  update public.bookings set booking_status='payment_pending',payment_status='pending' where id=p_booking_id;
  insert into public.booking_events(booking_id,actor_id,event_type,from_status,to_status,safe_metadata) values(p_booking_id,v_user,'payment_initialized',v_booking.booking_status,'payment_pending',jsonb_build_object('payment_id',v_payment.id));
  return jsonb_build_object('payment_id',v_payment.id,'reference',v_payment.provider_reference,'amount_kobo',v_payment.amount_kobo,'status',v_payment.status);
end;
$$;
revoke all on function public.prepare_booking_payment(uuid,text,text,uuid) from public;
grant execute on function public.prepare_booking_payment(uuid,text,text,uuid) to authenticated;

create or replace function public.process_verified_paystack_event(p_event_id text,p_reference text,p_amount_kobo bigint,p_currency text,p_event_type text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_payment public.payments%rowtype; v_booking public.bookings%rowtype; v_inserted int;
begin
  insert into public.payment_webhook_events(provider,provider_event_id,signature_valid,safe_payload,outcome) values('paystack',p_event_id,true,coalesce(p_payload,'{}'::jsonb),'received') on conflict(provider,provider_event_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted=0 then return jsonb_build_object('processed',true,'duplicate',true); end if;
  select * into v_payment from public.payments where provider_reference=p_reference and provider='paystack' for update;
  if not found then update public.payment_webhook_events set processed_at=now(),outcome='unknown_reference' where provider='paystack' and provider_event_id=p_event_id; return jsonb_build_object('processed',false,'reason','unknown_reference'); end if;
  if v_payment.amount_kobo<>p_amount_kobo or v_payment.currency<>p_currency then update public.payment_webhook_events set processed_at=now(),outcome='amount_or_currency_mismatch' where provider='paystack' and provider_event_id=p_event_id; return jsonb_build_object('processed',false,'reason','amount_or_currency_mismatch'); end if;
  if v_payment.status='paid' then update public.payment_webhook_events set processed_at=now(),outcome='already_paid' where provider='paystack' and provider_event_id=p_event_id; return jsonb_build_object('processed',true,'duplicate',true); end if;
  select * into v_booking from public.bookings where id=v_payment.booking_id for update;
  if p_event_type='charge.success' then
    update public.payments set status='paid',verified_amount_kobo=p_amount_kobo,verified_at=now(),updated_at=now() where id=v_payment.id;
    update public.bookings set payment_status='paid',payout_status='held' where id=v_booking.id;
    insert into public.payout_ledger(booking_id,host_id,entry_type,amount_kobo,safe_metadata) values
      (v_booking.id,v_booking.host_id,'booking_base',v_booking.base_amount_kobo,jsonb_build_object('payment_id',v_payment.id)),
        (v_booking.id,v_booking.host_id,'platform_commission',-v_booking.commission_kobo_snapshot,jsonb_build_object('commission_bps',v_booking.commission_bps_snapshot)),
        (v_booking.id,v_booking.host_id,'host_payable',v_booking.host_share_kobo_snapshot,jsonb_build_object('payout_status','held'));
    if v_booking.creator_fee_kobo>0 then
      insert into public.payout_ledger(booking_id,host_id,entry_type,amount_kobo,safe_metadata) values(v_booking.id,null,'creator_fee',v_booking.creator_fee_kobo,jsonb_build_object('fee_bps_snapshot',v_booking.creator_fee_bps_snapshot));
    end if;
    if v_booking.booking_status='payment_pending' then
      update public.bookings set booking_status='confirmed' where id=v_booking.id;
      insert into public.booking_events(booking_id,event_type,from_status,to_status,safe_metadata) values(v_booking.id,'payment_verified','payment_pending','confirmed',jsonb_build_object('payment_id',v_payment.id));
      insert into public.notifications(recipient_id,event_type,payload) values(v_booking.creator_id,'payment_confirmed',jsonb_build_object('booking_id',v_booking.id)),(v_booking.host_id,'booking_confirmed',jsonb_build_object('booking_id',v_booking.id));
      update public.payment_webhook_events set processed_at=now(),outcome='confirmed' where provider='paystack' and provider_event_id=p_event_id;
      return jsonb_build_object('processed',true,'duplicate',false,'booking_confirmed',true);
    end if;
    -- A delayed/duplicate provider success after the booking expired is recorded as paid but never confirmed or paid out.
    insert into public.booking_events(booking_id,event_type,from_status,to_status,safe_metadata) values(v_booking.id,'late_payment_requires_manual_refund_review',v_booking.booking_status,v_booking.booking_status,jsonb_build_object('payment_id',v_payment.id));
    insert into public.notifications(recipient_id,event_type,payload) values(v_booking.creator_id,'late_payment_review_required',jsonb_build_object('booking_id',v_booking.id)),(v_booking.host_id,'late_payment_review_required',jsonb_build_object('booking_id',v_booking.id));
    insert into public.notifications(recipient_id,event_type,payload) select ur.user_id,'late_payment_admin_review',jsonb_build_object('booking_id',v_booking.id,'payment_id',v_payment.id) from public.user_roles ur where ur.role='admin';
    update public.payment_webhook_events set processed_at=now(),outcome='paid_but_booking_not_confirmed_manual_review_required' where provider='paystack' and provider_event_id=p_event_id;
    return jsonb_build_object('processed',true,'duplicate',false,'booking_confirmed',false,'manual_review_required',true);
  elsif p_event_type='charge.failed' then
    update public.payments set status='failed',verified_at=now(),updated_at=now() where id=v_payment.id and status='pending';
    update public.bookings set payment_status='failed',booking_status='accepted_awaiting_payment' where id=v_booking.id and booking_status='payment_pending';
  end if;
  update public.payment_webhook_events set processed_at=now(),outcome='processed' where provider='paystack' and provider_event_id=p_event_id;
  return jsonb_build_object('processed',true,'duplicate',false);
end;
$$;
revoke all on function public.process_verified_paystack_event(text,text,bigint,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.process_verified_paystack_event(text,text,bigint,text,text,jsonb) to service_role;

create or replace function public.issue_booking_otp(p_booking_id uuid,p_code_hash text,p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid:=auth.uid(); v_booking public.bookings%rowtype; v_ttl int; v_before int; v_after int;
begin
  if v_user is null then raise exception 'authentication_required' using errcode='28000'; end if;
  select * into v_booking from public.bookings where id=p_booking_id and creator_id=v_user for update;
  if not found or v_booking.booking_status<>'confirmed' then raise exception 'booking_not_eligible_for_otp' using errcode='55000'; end if;
  select otp_ttl_minutes,otp_window_before_minutes,otp_window_after_minutes into v_ttl,v_before,v_after from public.platform_settings where id=true;
  if v_ttl is null or v_ttl < 1 or v_before is null or v_after is null then raise exception 'otp_window_not_configured' using errcode='55000'; end if;
  if p_expires_at<=now() or p_expires_at>now()+make_interval(mins=>v_ttl) then raise exception 'invalid_otp_expiry' using errcode='22023'; end if;
  if now() < v_booking.starts_at-make_interval(mins=>v_before) or now() > v_booking.ends_at+make_interval(mins=>v_after) then raise exception 'outside_checkin_window' using errcode='55000'; end if;
  if exists(select 1 from public.otp_sessions where booking_id=p_booking_id and issued_at>now()-interval '1 minute') then raise exception 'otp_issue_rate_limited' using errcode='55000'; end if;
  if (select count(*) from public.otp_sessions where booking_id=p_booking_id and issued_at>now()-interval '1 hour')>=5 then raise exception 'otp_issue_hourly_limit_reached' using errcode='55000'; end if;
  update public.otp_sessions set expires_at=now(),locked_at=coalesce(locked_at,now()) where booking_id=p_booking_id and used_at is null and locked_at is null;
  insert into public.otp_sessions(booking_id,code_hash,expires_at,max_attempts) values(p_booking_id,p_code_hash,p_expires_at,5);
  insert into public.booking_events(booking_id,actor_id,event_type,to_status) values(p_booking_id,v_user,'checkin_code_issued',v_booking.booking_status);
  return jsonb_build_object('expires_at',p_expires_at);
end;
$$;
revoke all on function public.issue_booking_otp(uuid,text,timestamptz) from public;
grant execute on function public.issue_booking_otp(uuid,text,timestamptz) to authenticated;

create or replace function public.verify_booking_otp(p_booking_id uuid,p_candidate_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid:=auth.uid(); v_booking public.bookings%rowtype; v_otp public.otp_sessions%rowtype;
begin
  if v_user is null then raise exception 'authentication_required' using errcode='28000'; end if;
  select * into v_booking from public.bookings where id=p_booking_id and host_id=v_user for update;
  if not found then raise exception 'booking_not_found' using errcode='P0002'; end if;
  if v_booking.booking_status<>'confirmed' then return jsonb_build_object('verified',false,'reason','booking_not_confirmed'); end if;
  select * into v_otp from public.otp_sessions where booking_id=p_booking_id order by issued_at desc limit 1 for update;
  if not found or v_otp.used_at is not null or v_otp.locked_at is not null or v_otp.expires_at<=now() then return jsonb_build_object('verified',false,'reason','code_unavailable'); end if;
  if v_otp.attempts>=v_otp.max_attempts then update public.otp_sessions set locked_at=now() where id=v_otp.id; return jsonb_build_object('verified',false,'reason','locked'); end if;
  if v_otp.code_hash<>p_candidate_hash then
    update public.otp_sessions set attempts=attempts+1,locked_at=case when attempts+1>=max_attempts then now() else null end where id=v_otp.id;
    insert into public.booking_events(booking_id,actor_id,event_type,from_status,to_status) values(p_booking_id,v_user,'checkin_code_failed','confirmed','confirmed');
    return jsonb_build_object('verified',false,'reason','invalid_or_expired');
  end if;
  update public.otp_sessions set used_at=now() where id=v_otp.id;
  update public.bookings set booking_status='checked_in' where id=p_booking_id;
  insert into public.booking_events(booking_id,actor_id,event_type,from_status,to_status) values(p_booking_id,v_user,'checkin_verified','confirmed','checked_in');
  return jsonb_build_object('verified',true,'booking_status','checked_in');
end;
$$;
revoke all on function public.verify_booking_otp(uuid,text) from public;
grant execute on function public.verify_booking_otp(uuid,text) to authenticated;

create or replace function public.host_submit_completion(p_booking_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid:=auth.uid(); v_booking public.bookings%rowtype;
begin
  select * into v_booking from public.bookings where id=p_booking_id and host_id=v_user for update;
  if not found or v_booking.booking_status<>'checked_in' then raise exception 'booking_not_ready_for_completion' using errcode='55000'; end if;
  update public.bookings set booking_status='completion_pending',completion_submitted_at=now() where id=p_booking_id;
  insert into public.booking_events(booking_id,actor_id,event_type,from_status,to_status) values(p_booking_id,v_user,'host_completion_submitted','checked_in','completion_pending');
  insert into public.notifications(recipient_id,event_type,payload) values(v_booking.creator_id,'completion_confirmation_requested',jsonb_build_object('booking_id',p_booking_id));
  return jsonb_build_object('booking_status','completion_pending');
end;
$$;
revoke all on function public.host_submit_completion(uuid) from public;
grant execute on function public.host_submit_completion(uuid) to authenticated;

create or replace function public.creator_confirm_completion(p_booking_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid:=auth.uid(); v_booking public.bookings%rowtype;
begin
  select * into v_booking from public.bookings where id=p_booking_id and creator_id=v_user for update;
  if not found or v_booking.booking_status<>'completion_pending' then raise exception 'booking_not_ready_to_complete' using errcode='55000'; end if;
  if exists(select 1 from public.disputes where booking_id=p_booking_id and status not in ('resolved','closed')) then raise exception 'open_dispute_holds_completion' using errcode='55000'; end if;
  update public.bookings set booking_status='completed',completed_at=now(),payout_status='held' where id=p_booking_id;
  insert into public.booking_events(booking_id,actor_id,event_type,from_status,to_status,safe_metadata) values(p_booking_id,v_user,'creator_completion_confirmed','completion_pending','completed',jsonb_build_object('payout_release_requires_configured_delay_and_operations_review',true));
  return jsonb_build_object('booking_status','completed','payout_status','held');
end;
$$;
revoke all on function public.creator_confirm_completion(uuid) from public;
grant execute on function public.creator_confirm_completion(uuid) to authenticated;

create or replace function public.open_booking_dispute(p_booking_id uuid,p_dispute_type text,p_description text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid:=auth.uid(); v_booking public.bookings%rowtype; v_dispute public.disputes%rowtype;
begin
  select * into v_booking from public.bookings where id=p_booking_id and (creator_id=v_user or host_id=v_user) for update;
  if not found then raise exception 'booking_not_found' using errcode='P0002'; end if;
  if v_booking.booking_status not in ('confirmed','checked_in','completion_pending','completed') then raise exception 'booking_not_disputable' using errcode='55000'; end if;
  insert into public.disputes(booking_id,opened_by,dispute_type,description) values(p_booking_id,v_user,left(p_dispute_type,80),left(p_description,10000)) returning * into v_dispute;
  update public.bookings set booking_status='disputed',payout_status='held' where id=p_booking_id;
  insert into public.booking_events(booking_id,actor_id,event_type,from_status,to_status) values(p_booking_id,v_user,'dispute_opened',v_booking.booking_status,'disputed');
  insert into public.admin_audit_log(actor_id,action,target_table,target_id,reason) values(v_user,'dispute_opened','bookings',p_booking_id::text,'User opened a booking dispute.');
  return jsonb_build_object('dispute_id',v_dispute.id,'status',v_dispute.status);
end;
$$;
revoke all on function public.open_booking_dispute(uuid,text,text) from public;
grant execute on function public.open_booking_dispute(uuid,text,text) to authenticated;

-- Host role requests are pending by default. No public path can grant admin/support.
create or replace function public.request_host_role(p_display_name text,p_bio text,p_terms_accepted boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid:=auth.uid();
begin
  if v_user is null then raise exception 'authentication_required' using errcode='28000'; end if;
  if not p_terms_accepted then raise exception 'host_terms_required' using errcode='22023'; end if;
  insert into public.user_roles(user_id,role,assigned_by) values(v_user,'host',v_user) on conflict do nothing;
  insert into public.host_profiles(user_id,public_display_name,bio,verification_status,host_terms_accepted_at)
  values(v_user,left(trim(p_display_name),120),left(coalesce(p_bio,''),3000),'pending',now())
  on conflict(user_id) do update set public_display_name=excluded.public_display_name,bio=excluded.bio,verification_status=case when public.host_profiles.verification_status in ('not_started','needs_changes') then 'pending' else public.host_profiles.verification_status end,host_terms_accepted_at=now(),updated_at=now();
  insert into public.host_verification_events(host_user_id,actor_id,to_status,reason) values(v_user,v_user,'pending','Host requested onboarding.');
  return jsonb_build_object('status','pending');
end;
$$;
revoke all on function public.request_host_role(text,text,boolean) from public;
grant execute on function public.request_host_role(text,text,boolean) to authenticated;

-- Supabase Auth callback profile/creator role and all production records start empty.
-- Admin bootstrap must be performed through a private owner-controlled SQL/CLI process and audited.
