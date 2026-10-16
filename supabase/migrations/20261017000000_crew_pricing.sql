-- Crew pricing (owner decision): base = hourly rate x hours x crew size.
-- Replaces request_booking_request with the SAME signature and body as
-- 20261011000000_initial_marketplace.sql, changing only the pricing block.
-- Existing bookings keep their stored snapshots; only new requests use this formula.

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
  -- Crew-priced: every person pays the hourly rate (owner decision, 2026-10-16).
  v_base := v_listing.hourly_rate_kobo * v_hours::bigint * p_crew_size::bigint;
  v_creator_fee := case when v_settings.creator_fee_approved then floor((v_base::numeric * v_settings.creator_fee_bps + 5000) / 10000)::bigint else 0 end;
  -- Computed before the check: a CASE expression inside an IF condition confuses PL/pgSQL's THEN detection.
  if v_base + v_creator_fee > 9000000000000000 then raise exception 'booking_total_too_large' using errcode='22023'; end if;
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
