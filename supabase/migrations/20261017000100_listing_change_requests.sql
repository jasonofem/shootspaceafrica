-- Owner-approved edits to a PUBLISHED listing (Part C).
-- A host proposes changes with a reason; an admin approves or rejects. Nothing changes on the
-- live listing until approval. Approved prices apply only to NEW bookings: existing bookings keep
-- their stored snapshots (hourly_rate_kobo_snapshot, base_amount_kobo, total_amount_kobo).
-- Photos are out of scope for change requests (register_listing_photo only accepts draft/changes_requested).

create table if not exists public.listing_change_requests (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  proposed_changes jsonb not null,          -- only whitelisted fields, validated by validate_listing_changes()
  reason text not null check (char_length(trim(reason)) between 10 and 2000),
  status text not null default 'pending' check (status in ('pending','approved','rejected','withdrawn')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists listing_change_requests_one_pending_idx
  on public.listing_change_requests(listing_id) where status = 'pending';
create index if not exists listing_change_requests_requester_idx on public.listing_change_requests(requested_by, created_at desc);

drop trigger if exists listing_change_requests_touch on public.listing_change_requests;
create trigger listing_change_requests_touch before update on public.listing_change_requests for each row execute function public.touch_updated_at();

-- Same table security as the rest of the marketplace: no direct writes, reads limited to owner/admin.
revoke all on public.listing_change_requests from anon, authenticated;
alter table public.listing_change_requests enable row level security;
grant select on public.listing_change_requests to authenticated;
drop policy if exists listing_change_requests_owner_admin_read on public.listing_change_requests;
create policy listing_change_requests_owner_admin_read on public.listing_change_requests for select to authenticated
  using (requested_by = auth.uid() or public.is_admin());

-- Whitelist + range checks. Same ranges as the listings table (and create_listing_draft).
-- Used both when a host asks for a change and again when an admin approves it.
create or replace function public.validate_listing_changes(p_changes jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_key text; v_value jsonb; v_text text; v_out jsonb := '{}'::jsonb; v_count integer := 0; v_rules jsonb; v_max integer;
  v_allowed text[] := array['hourly_rate_kobo','min_hours','crew_capacity','description','public_location','category','house_rules'];
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then raise exception 'invalid_listing_change' using errcode = '22023'; end if;
  for v_key in select jsonb_object_keys(p_changes) loop
    if not (v_key = any(v_allowed)) then raise exception 'invalid_listing_change' using errcode = '22023'; end if;
    v_value := p_changes -> v_key;
    v_count := v_count + 1;
    if v_key = 'hourly_rate_kobo' then
      v_text := v_value #>> '{}';
      if jsonb_typeof(v_value) <> 'number' or v_text !~ '^[0-9]{1,15}$' or v_text::bigint < 1 or v_text::bigint > 375000000000000 then raise exception 'invalid_listing_change' using errcode = '22023'; end if;
      v_out := v_out || jsonb_build_object(v_key, v_text::bigint);
    elsif v_key = 'min_hours' then
      v_text := v_value #>> '{}';
      if jsonb_typeof(v_value) <> 'number' or v_text !~ '^[0-9]{1,2}$' or v_text::int < 1 or v_text::int > 24 then raise exception 'invalid_listing_change' using errcode = '22023'; end if;
      v_out := v_out || jsonb_build_object(v_key, v_text::int);
    elsif v_key = 'crew_capacity' then
      v_text := v_value #>> '{}';
      if jsonb_typeof(v_value) <> 'number' or v_text !~ '^[0-9]{1,3}$' or v_text::int < 1 or v_text::int > 500 then raise exception 'invalid_listing_change' using errcode = '22023'; end if;
      v_out := v_out || jsonb_build_object(v_key, v_text::int);
    elsif v_key in ('description','category','public_location') then
      if jsonb_typeof(v_value) <> 'string' then raise exception 'invalid_listing_change' using errcode = '22023'; end if;
      v_text := trim(v_value #>> '{}');
      v_max := case when v_key = 'description' then 5000 when v_key = 'category' then 80 else 250 end;
      if (v_key in ('description','category') and char_length(v_text) < 1) or char_length(v_text) > v_max then
        raise exception 'invalid_listing_change' using errcode = '22023';
      end if;
      v_out := v_out || jsonb_build_object(v_key, v_text);
    else -- house_rules
      if jsonb_typeof(v_value) <> 'array' or jsonb_array_length(v_value) > 40 then raise exception 'invalid_listing_change' using errcode = '22023'; end if;
      if exists (select 1 from jsonb_array_elements(v_value) e where jsonb_typeof(e) <> 'string' or char_length(trim(e #>> '{}')) not between 1 and 400) then
        raise exception 'invalid_listing_change' using errcode = '22023';
      end if;
      select coalesce(jsonb_agg(trim(e #>> '{}') order by ord), '[]'::jsonb) into v_rules from jsonb_array_elements(v_value) with ordinality as x(e, ord);
      v_out := v_out || jsonb_build_object(v_key, v_rules);
    end if;
  end loop;
  if v_count = 0 then raise exception 'invalid_listing_change' using errcode = '22023'; end if;
  return v_out;
end;
$$;
revoke all on function public.validate_listing_changes(jsonb) from public, anon, authenticated;

create or replace function public.request_listing_change(p_listing_id uuid, p_changes jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_listing public.listings%rowtype; v_normalized jsonb; v_reason text; v_request_id uuid;
begin
  if v_user is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_user and role = 'host') then raise exception 'host_role_required' using errcode = '42501'; end if;
  select * into v_listing from public.listings where id = p_listing_id and owner_id = v_user for update;
  if not found then raise exception 'listing_not_found' using errcode = 'P0002'; end if;
  if v_listing.status <> 'published' then raise exception 'listing_not_published' using errcode = '55000'; end if;
  v_reason := trim(coalesce(p_reason, ''));
  if char_length(v_reason) < 10 or char_length(v_reason) > 2000 then raise exception 'invalid_listing_change' using errcode = '22023'; end if;
  v_normalized := public.validate_listing_changes(p_changes);
  begin
    insert into public.listing_change_requests(listing_id, requested_by, proposed_changes, reason)
    values (p_listing_id, v_user, v_normalized, v_reason) returning id into v_request_id;
  exception when unique_violation then
    raise exception 'listing_change_already_pending' using errcode = '55000';
  end;
  insert into public.notifications(recipient_id, event_type, payload)
  select ur.user_id, 'listing_change_requested', jsonb_build_object('listing_id', p_listing_id, 'change_request_id', v_request_id)
  from public.user_roles ur where ur.role = 'admin';
  return jsonb_build_object('change_request_id', v_request_id, 'status', 'pending');
end;
$$;
revoke all on function public.request_listing_change(uuid, jsonb, text) from public;
grant execute on function public.request_listing_change(uuid, jsonb, text) to authenticated;

create or replace function public.admin_review_listing_change(p_request_id uuid, p_decision text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid(); v_req public.listing_change_requests%rowtype; v_listing public.listings%rowtype; v_changes jsonb; v_next text; v_reason text;
begin
  if v_actor is null or not public.is_admin() then raise exception 'admin_role_required' using errcode = '42501'; end if;
  v_reason := trim(coalesce(p_reason, ''));
  if p_decision not in ('approve','reject') or char_length(v_reason) < 5 then raise exception 'invalid_listing_change_review' using errcode = '22023'; end if;
  select * into v_req from public.listing_change_requests where id = p_request_id for update;
  if not found then raise exception 'listing_change_not_found' using errcode = 'P0002'; end if;
  if v_req.status <> 'pending' then raise exception 'listing_change_not_open' using errcode = '55000'; end if;
  select * into v_listing from public.listings where id = v_req.listing_id for update;
  if p_decision = 'approve' then
    -- Re-validate: the stored proposal must still satisfy the same rules at the moment it goes live.
    v_changes := public.validate_listing_changes(v_req.proposed_changes);
    update public.listings set
      hourly_rate_kobo = coalesce((v_changes ->> 'hourly_rate_kobo')::bigint, hourly_rate_kobo),
      min_hours = coalesce((v_changes ->> 'min_hours')::smallint, min_hours),
      crew_capacity = coalesce((v_changes ->> 'crew_capacity')::smallint, crew_capacity),
      description = coalesce(v_changes ->> 'description', description),
      public_location = coalesce(v_changes ->> 'public_location', public_location),
      category = coalesce(v_changes ->> 'category', category),
      house_rules = case when v_changes ? 'house_rules' then array(select jsonb_array_elements_text(v_changes -> 'house_rules')) else house_rules end,
      updated_at = now()
    where id = v_req.listing_id;
    v_next := 'approved';
  else
    v_next := 'rejected';
  end if;
  update public.listing_change_requests set status = v_next, reviewed_by = v_actor, reviewed_at = now(), review_reason = left(v_reason, 2000) where id = p_request_id;
  insert into public.admin_audit_log(actor_id, action, target_table, target_id, reason, safe_before_after)
  values (v_actor, 'listing_change_' || p_decision, 'listing_change_requests', p_request_id::text, left(v_reason, 2000),
    jsonb_build_object('listing_id', v_req.listing_id, 'from', 'pending', 'to', v_next,
      'proposed_fields', (select coalesce(jsonb_agg(k.key order by k.key), '[]'::jsonb) from jsonb_object_keys(v_req.proposed_changes) as k(key))));
  insert into public.notifications(recipient_id, event_type, payload)
  values (v_listing.owner_id, 'listing_change_' || case when p_decision = 'approve' then 'approved' else 'rejected' end,
    jsonb_build_object('listing_id', v_req.listing_id, 'change_request_id', p_request_id, 'reason', left(v_reason, 500)));
  return jsonb_build_object('change_request_id', p_request_id, 'status', v_next, 'listing_id', v_req.listing_id);
end;
$$;
revoke all on function public.admin_review_listing_change(uuid, text, text) from public;
grant execute on function public.admin_review_listing_change(uuid, text, text) to authenticated;
