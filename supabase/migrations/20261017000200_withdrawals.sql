-- Withdrawal REQUESTS (record-and-track). Nothing in this migration or in the application moves money.
-- Flow: a host or the company requests a withdrawal -> an admin approves -> the owner pays manually
-- from the Paystack dashboard / bank -> the admin marks it paid with the payment reference.
-- No Paystack transfer or payout endpoint is called anywhere in this codebase.
--
-- Host money: payouts (status eligible -> queued -> paid) and bookings.payout_status follow the same states.
-- Company commission: tracked via withdrawal_request_commissions (one booking's commission can be claimed once).
-- It never changes bookings.payout_status, because that field describes the host's share, not the commission.

create table public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete restrict,
  requester_role text not null check (requester_role in ('host','platform')),
  amount_kobo bigint not null check (amount_kobo > 0),
  status text not null default 'pending' check (status in ('pending','approved','paid','rejected','cancelled')),
  note text check (char_length(coalesce(note,'')) <= 600),
  payment_reference text unique,           -- the owner's manual Paystack/bank reference
  requested_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  paid_at timestamptz,
  review_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index withdrawal_requests_requester_idx on public.withdrawal_requests(requester_id, requested_at desc);
create index withdrawal_requests_status_idx on public.withdrawal_requests(status, requested_at);

create table public.withdrawal_request_payouts (      -- host claims
  withdrawal_request_id uuid not null references public.withdrawal_requests(id) on delete cascade,
  payout_id uuid not null references public.payouts(id) on delete restrict,
  primary key (withdrawal_request_id, payout_id),
  unique (payout_id)                                  -- a payout can only be claimed once
);

create table public.withdrawal_request_commissions (  -- company claims
  withdrawal_request_id uuid not null references public.withdrawal_requests(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete restrict,
  primary key (withdrawal_request_id, booking_id),
  unique (booking_id)                                 -- commission claimed once
);

drop trigger if exists withdrawal_requests_touch on public.withdrawal_requests;
create trigger withdrawal_requests_touch before update on public.withdrawal_requests for each row execute function public.touch_updated_at();

-- Same security as the rest of the marketplace: blanket revoke, RLS on, reads limited to requester/admin,
-- and every write goes through the security definer functions below.
revoke all on public.withdrawal_requests, public.withdrawal_request_payouts, public.withdrawal_request_commissions from anon, authenticated;
alter table public.withdrawal_requests enable row level security;
alter table public.withdrawal_request_payouts enable row level security;
alter table public.withdrawal_request_commissions enable row level security;
grant select on public.withdrawal_requests, public.withdrawal_request_payouts, public.withdrawal_request_commissions to authenticated;
drop policy if exists withdrawal_requests_requester_admin_read on public.withdrawal_requests;
create policy withdrawal_requests_requester_admin_read on public.withdrawal_requests for select to authenticated
  using (requester_id = auth.uid() or public.is_admin());
drop policy if exists withdrawal_request_payouts_requester_admin_read on public.withdrawal_request_payouts;
create policy withdrawal_request_payouts_requester_admin_read on public.withdrawal_request_payouts for select to authenticated
  using (exists (select 1 from public.withdrawal_requests w where w.id = withdrawal_request_id and (w.requester_id = auth.uid() or public.is_admin())));
drop policy if exists withdrawal_request_commissions_admin_read on public.withdrawal_request_commissions;
create policy withdrawal_request_commissions_admin_read on public.withdrawal_request_commissions for select to authenticated
  using (exists (select 1 from public.withdrawal_requests w where w.id = withdrawal_request_id and (w.requester_id = auth.uid() or public.is_admin())));

-- Shared re-check used at approval and at payment time: every linked item must still be matured
-- (booking completed and paid, no open dispute). A dispute opened after a request was made blocks payment.
create or replace function public.withdrawal_items_still_eligible(p_request_id uuid)
returns boolean language plpgsql set search_path = public as $$
declare v_role text; v_linked integer := 0; v_ok integer := 0;
begin
  select requester_role into v_role from public.withdrawal_requests where id = p_request_id;
  if v_role is null then return false; end if;
  if v_role = 'host' then
    select count(*) into v_linked from public.withdrawal_request_payouts where withdrawal_request_id = p_request_id;
    select count(*) into v_ok from public.withdrawal_request_payouts wp
      join public.payouts p on p.id = wp.payout_id
      join public.bookings b on b.id = p.booking_id
    where wp.withdrawal_request_id = p_request_id and p.status = 'queued'
      and b.booking_status = 'completed' and b.payment_status = 'paid'
      and not exists (select 1 from public.disputes d where d.booking_id = b.id and d.status not in ('resolved','closed'));
  else
    select count(*) into v_linked from public.withdrawal_request_commissions where withdrawal_request_id = p_request_id;
    select count(*) into v_ok from public.withdrawal_request_commissions wc
      join public.bookings b on b.id = wc.booking_id
    where wc.withdrawal_request_id = p_request_id
      and b.booking_status = 'completed' and b.payment_status = 'paid'
      and b.payout_status in ('eligible','queued','processing','paid')
      and not exists (select 1 from public.disputes d where d.booking_id = b.id and d.status not in ('resolved','closed'));
  end if;
  return v_linked > 0 and v_linked = v_ok;
end;
$$;
revoke all on function public.withdrawal_items_still_eligible(uuid) from public, anon, authenticated;

-- Host: request every matured payout. The payout rows are locked BEFORE they are summed, so two
-- requests at the same time cannot claim the same money.
create or replace function public.request_host_withdrawal(p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_row record; v_ids uuid[]; v_booking_ids uuid[]; v_total bigint := 0; v_count integer := 0; v_request_id uuid; v_note text;
begin
  if v_user is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_user and role = 'host') then raise exception 'host_role_required' using errcode = '42501'; end if;
  if (select count(*) from public.withdrawal_requests where requester_id = v_user and requested_at > now() - interval '1 hour') >= 5 then
    raise exception 'withdrawal_rate_limited' using errcode = '55000';
  end if;
  v_note := left(trim(coalesce(p_note, '')), 600);
  for v_row in
    select p.id as payout_id, p.booking_id, p.amount_kobo
    from public.payouts p join public.bookings b on b.id = p.booking_id
    where p.host_id = v_user and p.status = 'eligible'
      and b.booking_status = 'completed' and b.payment_status = 'paid' and b.payout_status = 'eligible'
      and not exists (select 1 from public.disputes d where d.booking_id = b.id and d.status not in ('resolved','closed'))
    order by p.created_at
    for update of p
  loop
    v_count := v_count + 1;
    v_total := v_total + v_row.amount_kobo;
    v_ids := array_append(v_ids, v_row.payout_id);
    v_booking_ids := array_append(v_booking_ids, v_row.booking_id);
  end loop;
  if v_count = 0 or v_total <= 0 then raise exception 'no_eligible_payouts' using errcode = '55000'; end if;
  insert into public.withdrawal_requests(requester_id, requester_role, amount_kobo, status, note)
  values (v_user, 'host', v_total, 'pending', nullif(v_note, '')) returning id into v_request_id;
  insert into public.withdrawal_request_payouts(withdrawal_request_id, payout_id) select v_request_id, unnest(v_ids);
  update public.payouts set status = 'queued', updated_at = now() where id = any(v_ids);
  update public.bookings set payout_status = 'queued', updated_at = now() where id = any(v_booking_ids) and payout_status = 'eligible';
  insert into public.notifications(recipient_id, event_type, payload)
  select ur.user_id, 'withdrawal_requested', jsonb_build_object('withdrawal_request_id', v_request_id, 'requester_role', 'host', 'amount_kobo', v_total)
  from public.user_roles ur where ur.role = 'admin';
  return jsonb_build_object('request_id', v_request_id, 'amount_kobo', v_total, 'status', 'pending');
end;
$$;
revoke all on function public.request_host_withdrawal(text) from public;
grant execute on function public.request_host_withdrawal(text) to authenticated;

-- Company: claim matured commission that has not been claimed yet. Mirrors host maturity:
-- payment captured, booking completed, host hold elapsed (payout eligible or later), no open dispute.
-- Refunded bookings (payment_status refund_pending) never count.
create or replace function public.request_platform_withdrawal(p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_row record; v_booking_ids uuid[]; v_total bigint := 0; v_count integer := 0; v_request_id uuid; v_note text;
begin
  if v_user is null then raise exception 'authentication_required' using errcode = '28000'; end if;
  if not public.is_admin() then raise exception 'admin_role_required' using errcode = '42501'; end if;
  -- Serialises company claims so two concurrent requests cannot both claim the same commission.
  perform pg_advisory_xact_lock(hashtextextended('platform_commission_withdrawal', 0));
  if (select count(*) from public.withdrawal_requests where requester_id = v_user and requested_at > now() - interval '1 hour') >= 5 then
    raise exception 'withdrawal_rate_limited' using errcode = '55000';
  end if;
  v_note := left(trim(coalesce(p_note, '')), 600);
  for v_row in
    select b.id as booking_id, b.commission_kobo_snapshot as amount_kobo
    from public.bookings b
    where b.payment_status = 'paid' and b.booking_status = 'completed'
      and b.payout_status in ('eligible','queued','processing','paid')
      and not exists (select 1 from public.withdrawal_request_commissions c where c.booking_id = b.id)
      and not exists (select 1 from public.disputes d where d.booking_id = b.id and d.status not in ('resolved','closed'))
    order by b.completed_at nulls last, b.id
    for update of b
  loop
    v_count := v_count + 1;
    v_total := v_total + v_row.amount_kobo;
    v_booking_ids := array_append(v_booking_ids, v_row.booking_id);
  end loop;
  if v_count = 0 or v_total <= 0 then raise exception 'no_available_commission' using errcode = '55000'; end if;
  insert into public.withdrawal_requests(requester_id, requester_role, amount_kobo, status, note)
  values (v_user, 'platform', v_total, 'pending', nullif(v_note, '')) returning id into v_request_id;
  insert into public.withdrawal_request_commissions(withdrawal_request_id, booking_id) select v_request_id, unnest(v_booking_ids);
  insert into public.admin_audit_log(actor_id, action, target_table, target_id, reason, safe_before_after)
  values (v_user, 'platform_withdrawal_requested', 'withdrawal_requests', v_request_id::text,
    coalesce(nullif(v_note, ''), 'Company commission withdrawal requested.'),
    jsonb_build_object('amount_kobo', v_total, 'booking_count', v_count));
  return jsonb_build_object('request_id', v_request_id, 'amount_kobo', v_total, 'status', 'pending');
end;
$$;
revoke all on function public.request_platform_withdrawal(text) from public;
grant execute on function public.request_platform_withdrawal(text) to authenticated;

-- Admin review. approve: pending -> approved (no money moves). mark_paid: approved -> paid, after the owner
-- has paid manually and entered the reference. reject: pending|approved -> rejected, and the claimed
-- funds are released so they can be requested again.
create or replace function public.admin_review_withdrawal(p_request_id uuid, p_decision text, p_reason text, p_payment_reference text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid(); v_req public.withdrawal_requests%rowtype; v_reason text; v_ref text; v_next text;
  v_payout_ids uuid[]; v_booking_ids uuid[];
begin
  if v_actor is null or not public.is_admin() then raise exception 'admin_role_required' using errcode = '42501'; end if;
  v_reason := trim(coalesce(p_reason, ''));
  if p_decision not in ('approve','mark_paid','reject') or char_length(v_reason) < 5 then raise exception 'invalid_withdrawal_decision' using errcode = '22023'; end if;
  v_ref := nullif(trim(coalesce(p_payment_reference, '')), '');
  if p_decision = 'mark_paid' and v_ref is null then raise exception 'withdrawal_reference_required' using errcode = '22023'; end if;
  select * into v_req from public.withdrawal_requests where id = p_request_id for update;
  if not found then raise exception 'withdrawal_not_found' using errcode = 'P0002'; end if;

  if p_decision = 'approve' then
    if v_req.status <> 'pending' then raise exception 'withdrawal_not_open' using errcode = '55000'; end if;
    if not public.withdrawal_items_still_eligible(p_request_id) then raise exception 'withdrawal_item_not_eligible' using errcode = '55000'; end if;
    v_next := 'approved';
    update public.withdrawal_requests set status = 'approved', reviewed_by = v_actor, reviewed_at = now(), review_reason = left(v_reason, 2000) where id = p_request_id;

  elsif p_decision = 'mark_paid' then
    if v_req.status <> 'approved' then raise exception 'withdrawal_not_open' using errcode = '55000'; end if;
    if not public.withdrawal_items_still_eligible(p_request_id) then raise exception 'withdrawal_item_not_eligible' using errcode = '55000'; end if;
    begin
      update public.withdrawal_requests set status = 'paid', paid_at = now(), payment_reference = v_ref, reviewed_by = v_actor, reviewed_at = now(), review_reason = left(v_reason, 2000) where id = p_request_id;
    exception when unique_violation then
      raise exception 'withdrawal_reference_already_used' using errcode = '22023';
    end;
    if v_req.requester_role = 'host' then
      select coalesce(array_agg(wp.payout_id), '{}'), coalesce(array_agg(distinct p.booking_id), '{}')
        into v_payout_ids, v_booking_ids
      from public.withdrawal_request_payouts wp join public.payouts p on p.id = wp.payout_id
      where wp.withdrawal_request_id = p_request_id;
      update public.payouts set status = 'paid', confirmed_at = now(), provider = 'manual', audit_actor = v_actor, updated_at = now() where id = any(v_payout_ids);
      update public.bookings set payout_status = 'paid', updated_at = now() where id = any(v_booking_ids);
    end if;
    v_next := 'paid';

  else -- reject
    if v_req.status not in ('pending','approved') then raise exception 'withdrawal_not_open' using errcode = '55000'; end if;
    if v_req.requester_role = 'host' then
      select coalesce(array_agg(wp.payout_id), '{}'), coalesce(array_agg(distinct p.booking_id), '{}')
        into v_payout_ids, v_booking_ids
      from public.withdrawal_request_payouts wp join public.payouts p on p.id = wp.payout_id
      where wp.withdrawal_request_id = p_request_id;
      update public.payouts set status = 'eligible', updated_at = now() where id = any(v_payout_ids) and status = 'queued';
      update public.bookings set payout_status = 'eligible', updated_at = now() where id = any(v_booking_ids) and payout_status = 'queued';
      delete from public.withdrawal_request_payouts where withdrawal_request_id = p_request_id;
    else
      delete from public.withdrawal_request_commissions where withdrawal_request_id = p_request_id;
    end if;
    v_next := 'rejected';
    update public.withdrawal_requests set status = 'rejected', reviewed_by = v_actor, reviewed_at = now(), review_reason = left(v_reason, 2000) where id = p_request_id;
  end if;

  insert into public.admin_audit_log(actor_id, action, target_table, target_id, reason, safe_before_after)
  values (v_actor, 'withdrawal_' || p_decision, 'withdrawal_requests', p_request_id::text, left(v_reason, 2000),
    jsonb_build_object('from', v_req.status, 'to', v_next, 'amount_kobo', v_req.amount_kobo, 'requester_role', v_req.requester_role));
  insert into public.notifications(recipient_id, event_type, payload)
  values (v_req.requester_id, 'withdrawal_' || case p_decision when 'approve' then 'approved' when 'mark_paid' then 'paid' else 'rejected' end,
    jsonb_build_object('withdrawal_request_id', p_request_id, 'amount_kobo', v_req.amount_kobo, 'reason', left(v_reason, 500)));
  return jsonb_build_object('request_id', p_request_id, 'status', v_next, 'amount_kobo', v_req.amount_kobo);
end;
$$;
revoke all on function public.admin_review_withdrawal(uuid, text, text, text) from public;
grant execute on function public.admin_review_withdrawal(uuid, text, text, text) to authenticated;
