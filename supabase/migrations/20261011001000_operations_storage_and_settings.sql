-- Operational workflows, private media buckets and owner-controlled settings.

alter table public.platform_settings
  add column if not exists otp_window_before_minutes integer check (otp_window_before_minutes >= 0),
  add column if not exists otp_window_after_minutes integer check (otp_window_after_minutes >= 0),
  add column if not exists cancellation_policy_text text;

create table if not exists public.host_verification_documents (
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
alter table public.host_verification_documents enable row level security;
revoke all on public.host_verification_documents from anon, authenticated;
grant select on public.host_verification_documents to authenticated;
drop policy if exists host_documents_read_owner_admin on public.host_verification_documents;
drop policy if exists host_documents_insert_self on public.host_verification_documents;
create policy host_documents_read_owner_admin on public.host_verification_documents for select to authenticated using (host_user_id = auth.uid() or public.is_admin());
create policy host_documents_insert_self on public.host_verification_documents for insert to authenticated with check (uploaded_by = auth.uid() and host_user_id = auth.uid() and review_status = 'pending' and reviewed_by is null);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values
  ('listing-photos','listing-photos',false,10485760,array['image/jpeg','image/png','image/webp']),
  ('verification-documents','verification-documents',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf']),
  ('dispute-evidence','dispute-evidence',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

-- Media stays private; public listing images are exposed only through short-lived server-signed URLs
-- for records returned by public_listings. KYC and dispute objects are always private.
drop policy if exists listing_media_owner_read on storage.objects;
drop policy if exists listing_media_owner_insert on storage.objects;
drop policy if exists listing_media_owner_delete on storage.objects;
create policy listing_media_owner_read on storage.objects for select to authenticated using (
  bucket_id='listing-photos' and (
    public.is_admin() or exists (
      select 1 from public.listings l where l.id=(storage.foldername(name))[1]::uuid and l.owner_id=auth.uid()
    )
  )
);
create policy listing_media_owner_insert on storage.objects for insert to authenticated with check (
  bucket_id='listing-photos' and exists (
    select 1 from public.listings l where l.id=(storage.foldername(name))[1]::uuid and l.owner_id=auth.uid() and l.status in ('draft','changes_requested')
  )
);
create policy listing_media_owner_delete on storage.objects for delete to authenticated using (
  bucket_id='listing-photos' and exists (
    select 1 from public.listings l where l.id=(storage.foldername(name))[1]::uuid and l.owner_id=auth.uid() and l.status in ('draft','changes_requested')
  )
);
drop policy if exists host_private_documents_owner on storage.objects;
create policy host_private_documents_owner on storage.objects for select to authenticated using (
  bucket_id='verification-documents' and (public.is_admin() or (storage.foldername(name))[1]=auth.uid()::text)
);
drop policy if exists host_private_documents_insert on storage.objects;
create policy host_private_documents_insert on storage.objects for insert to authenticated with check (
  bucket_id='verification-documents' and (storage.foldername(name))[1]=auth.uid()::text
  and exists (select 1 from public.host_profiles h where h.user_id=auth.uid() and h.verification_status in ('not_started','pending','needs_changes'))
);
drop policy if exists dispute_private_evidence_read on storage.objects;
create policy dispute_private_evidence_read on storage.objects for select to authenticated using (
  bucket_id='dispute-evidence' and (
    public.is_admin() or exists (
      select 1 from public.dispute_evidence e join public.disputes d on d.id=e.dispute_id
      where e.storage_path=name and (e.uploaded_by=auth.uid() or d.opened_by=auth.uid() or exists (select 1 from public.bookings b where b.id=d.booking_id and (b.creator_id=auth.uid() or b.host_id=auth.uid())))
    )
  )
);
drop policy if exists dispute_private_evidence_insert on storage.objects;
create policy dispute_private_evidence_insert on storage.objects for insert to authenticated with check (
  bucket_id='dispute-evidence'
  and (storage.foldername(name))[1]=auth.uid()::text
  and exists (
    select 1 from public.disputes d join public.bookings b on b.id=d.booking_id
    where d.id::text=(storage.foldername(name))[2]
      and d.status not in ('resolved','closed')
      and (d.opened_by=auth.uid() or b.creator_id=auth.uid() or b.host_id=auth.uid())
  )
);

create or replace function public.create_listing_draft(
  p_slug text,p_title text,p_category text,p_description text,p_city text,p_neighbourhood text,
  p_public_location text,p_exact_address text,p_hourly_rate_kobo bigint,p_min_hours smallint,
  p_crew_capacity smallint,p_house_rules text[],p_amenity_ids uuid[],p_availability jsonb
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid(); v_listing public.listings%rowtype; v_rule record; v_requested int; v_inserted int;
begin
  if v_user is null then raise exception 'authentication_required' using errcode='28000'; end if;
  if not exists(select 1 from public.user_roles where user_id=v_user and role='host') then raise exception 'host_role_required' using errcode='42501'; end if;
  if not exists(select 1 from public.host_profiles where user_id=v_user and verification_status in ('pending','approved','needs_changes')) then raise exception 'host_onboarding_required' using errcode='55000'; end if;
  if nullif(trim(p_exact_address),'') is null then raise exception 'exact_address_required' using errcode='22023'; end if;
  if p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(p_slug)>100 then raise exception 'invalid_listing_slug' using errcode='22023'; end if;
  insert into public.listings(owner_id,slug,title,category,description,city,neighbourhood,public_location,exact_address,hourly_rate_kobo,min_hours,crew_capacity,house_rules,status)
  values(v_user,p_slug,left(trim(p_title),120),left(trim(p_category),80),left(trim(p_description),5000),left(trim(p_city),100),left(trim(p_neighbourhood),120),left(trim(p_public_location),250),left(trim(p_exact_address),500),p_hourly_rate_kobo,p_min_hours,p_crew_capacity,coalesce(p_house_rules,'{}'),'draft') returning * into v_listing;
  v_requested:=coalesce(array_length(p_amenity_ids,1),0);
  if v_requested>0 then
    insert into public.listing_amenities(listing_id,amenity_id)
    select v_listing.id,a.id from public.amenities a where a.id=any(p_amenity_ids) and a.is_active on conflict do nothing;
    get diagnostics v_inserted=row_count;
    if v_inserted<>v_requested then raise exception 'unknown_or_duplicate_amenities' using errcode='22023'; end if;
  end if;
  for v_rule in select * from jsonb_to_recordset(coalesce(p_availability,'[]'::jsonb)) as x(weekday smallint,opens_at time,closes_at time) loop
    if v_rule.weekday not between 0 and 6 or v_rule.opens_at>=v_rule.closes_at then raise exception 'invalid_availability_rule' using errcode='22023'; end if;
    insert into public.availability_rules(listing_id,weekday,opens_at,closes_at) values(v_listing.id,v_rule.weekday,v_rule.opens_at,v_rule.closes_at);
  end loop;
  return jsonb_build_object('id',v_listing.id,'slug',v_listing.slug,'status',v_listing.status);
end;
$$;
revoke all on function public.create_listing_draft(text,text,text,text,text,text,text,text,bigint,smallint,smallint,text[],uuid[],jsonb) from public;
grant execute on function public.create_listing_draft(text,text,text,text,text,text,text,text,bigint,smallint,smallint,text[],uuid[],jsonb) to authenticated;

create or replace function public.admin_review_host(p_host_user_id uuid,p_decision text,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=auth.uid(); v_before text; v_after text;
begin
  if v_actor is null or not public.is_admin() then raise exception 'admin_role_required' using errcode='42501'; end if;
  if p_decision not in ('approve','request_changes','reject','suspend') or char_length(trim(p_reason))<5 then raise exception 'invalid_host_review' using errcode='22023'; end if;
  select verification_status into v_before from public.host_profiles where user_id=p_host_user_id for update;
  if not found then raise exception 'host_not_found' using errcode='P0002'; end if;
  v_after:=case p_decision when 'approve' then 'approved' when 'request_changes' then 'needs_changes' when 'reject' then 'rejected' else 'suspended' end;
  update public.host_profiles set verification_status=v_after,reviewed_at=now(),reviewed_by=v_actor,review_reason=left(p_reason,2000) where user_id=p_host_user_id;
  insert into public.host_verification_events(host_user_id,actor_id,from_status,to_status,reason) values(p_host_user_id,v_actor,v_before,v_after,left(p_reason,2000));
  insert into public.admin_audit_log(actor_id,action,target_table,target_id,reason,safe_before_after) values(v_actor,'host_review_'||p_decision,'host_profiles',p_host_user_id::text,left(p_reason,2000),jsonb_build_object('from',v_before,'to',v_after));
  insert into public.notifications(recipient_id,event_type,payload) values(p_host_user_id,'host_verification_'||v_after,jsonb_build_object('status',v_after,'reason',left(p_reason,500)));
  return jsonb_build_object('host_user_id',p_host_user_id,'verification_status',v_after);
end;
$$;
revoke all on function public.admin_review_host(uuid,text,text) from public;
grant execute on function public.admin_review_host(uuid,text,text) to authenticated;

create or replace function public.admin_review_listing(p_listing_id uuid,p_decision text,p_reason text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=auth.uid(); v_listing public.listings%rowtype; v_next text; v_photos int; v_availability int;
begin
  if v_actor is null or not public.is_admin() then raise exception 'admin_role_required' using errcode='42501'; end if;
  if p_decision not in ('approve','request_changes','reject','pause') or char_length(trim(p_reason))<5 then raise exception 'invalid_listing_review' using errcode='22023'; end if;
  select * into v_listing from public.listings where id=p_listing_id for update;
  if not found then raise exception 'listing_not_found' using errcode='P0002'; end if;
  if p_decision='approve' then
    if v_listing.status<>'submitted' or not exists(select 1 from public.host_profiles where user_id=v_listing.owner_id and verification_status='approved') then raise exception 'listing_review_requirements_not_met' using errcode='55000'; end if;
    select count(*) into v_photos from public.listing_photos where listing_id=p_listing_id and source_type='host_upload';
    select count(*) into v_availability from public.availability_rules where listing_id=p_listing_id and active;
    if v_photos<1 or v_availability<1 then raise exception 'listing_review_requirements_not_met' using errcode='55000'; end if;
    update public.listing_photos set moderation_status='approved' where listing_id=p_listing_id and moderation_status='pending';
    v_next:='published';
  elsif p_decision='request_changes' then v_next:='changes_requested';
  elsif p_decision='reject' then v_next:='rejected';
  else v_next:='paused';
  end if;
  update public.listings set status=v_next,moderation_reason=left(p_reason,2000),reviewed_by=v_actor,reviewed_at=now(),submitted_at=case when v_next='published' then submitted_at else submitted_at end where id=p_listing_id;
  insert into public.admin_audit_log(actor_id,action,target_table,target_id,reason,safe_before_after) values(v_actor,'listing_review_'||p_decision,'listings',p_listing_id::text,left(p_reason,2000),jsonb_build_object('from',v_listing.status,'to',v_next));
  insert into public.notifications(recipient_id,event_type,payload) values(v_listing.owner_id,'listing_review_'||v_next,jsonb_build_object('listing_id',p_listing_id,'status',v_next,'reason',left(p_reason,500)));
  return jsonb_build_object('listing_id',p_listing_id,'status',v_next);
end;
$$;
revoke all on function public.admin_review_listing(uuid,text,text) from public;
grant execute on function public.admin_review_listing(uuid,text,text) to authenticated;

create or replace function public.create_contact_request(p_full_name text,p_email text,p_phone text,p_subject text,p_message text,p_ip_fingerprint text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if char_length(trim(p_full_name))<2 or char_length(trim(p_email))<5 or char_length(trim(p_subject))<2 or char_length(trim(p_message))<10 then raise exception 'invalid_contact_request' using errcode='22023'; end if;
  if (select count(*) from public.contact_requests where ip_fingerprint=p_ip_fingerprint and created_at>now()-interval '1 hour')>=5 then raise exception 'contact_rate_limited' using errcode='55000'; end if;
  insert into public.contact_requests(full_name,email,phone,subject,message,ip_fingerprint)
  values(left(trim(p_full_name),120),lower(left(trim(p_email),254)),left(trim(coalesce(p_phone,'')),40),left(trim(p_subject),160),left(trim(p_message),10000),p_ip_fingerprint) returning id into v_id;
  return jsonb_build_object('id',v_id);
end;
$$;
revoke all on function public.create_contact_request(text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.create_contact_request(text,text,text,text,text,text) to service_role;

create policy contact_requests_admin_read on public.contact_requests for select to authenticated using (public.is_admin());
grant select on public.contact_requests to authenticated;

create or replace function public.expire_stale_bookings()
returns integer language plpgsql security definer set search_path=public as $$
declare v_count integer:=0; v_row record;
begin
  for v_row in update public.bookings b set booking_status='expired',payment_status=case when b.booking_status='payment_pending' then 'failed' else b.payment_status end,updated_at=now()
    where ((b.booking_status='request_pending' and b.request_expires_at is not null and b.request_expires_at<=now()) or (b.booking_status in ('accepted_awaiting_payment','payment_pending') and b.payment_expires_at is not null and b.payment_expires_at<=now()))
      and not exists(select 1 from public.payments p where p.booking_id=b.id and p.status='paid')
    returning b.id,b.creator_id,b.host_id,b.booking_status
  loop
    v_count:=v_count+1;
    insert into public.booking_events(booking_id,event_type,from_status,to_status) values(v_row.id,'booking_expired',null,'expired');
    insert into public.notifications(recipient_id,event_type,payload) values(v_row.creator_id,'booking_expired',jsonb_build_object('booking_id',v_row.id)),(v_row.host_id,'booking_expired',jsonb_build_object('booking_id',v_row.id));
  end loop;
  return v_count;
end;
$$;
revoke all on function public.expire_stale_bookings() from public,anon,authenticated;
grant execute on function public.expire_stale_bookings() to service_role;

create or replace function public.release_mature_payouts()
returns integer language plpgsql security definer set search_path=public as $$
declare v_delay integer; v_count integer:=0; v_booking record;
begin
  select payout_delay_hours into v_delay from public.platform_settings where id=true;
  if v_delay is null then return 0; end if;
  for v_booking in update public.bookings b set payout_status='eligible',updated_at=now()
    where b.booking_status='completed' and b.payment_status='paid' and b.payout_status='held'
      and b.completed_at+make_interval(hours=>v_delay)<=now()
      and not exists(select 1 from public.disputes d where d.booking_id=b.id and d.status not in ('resolved','closed'))
    returning b.id,b.host_id,b.host_share_kobo_snapshot
  loop
    v_count:=v_count+1;
    insert into public.payouts(booking_id,host_id,amount_kobo,status) values(v_booking.id,v_booking.host_id,v_booking.host_share_kobo_snapshot,'eligible') on conflict(booking_id) do update set status='eligible',updated_at=now() where payouts.status='held';
    insert into public.notifications(recipient_id,event_type,payload) values(v_booking.host_id,'payout_eligible',jsonb_build_object('booking_id',v_booking.id,'amount_kobo',v_booking.host_share_kobo_snapshot));
  end loop;
  return v_count;
end;
$$;
revoke all on function public.release_mature_payouts() from public,anon,authenticated;
grant execute on function public.release_mature_payouts() to service_role;

create or replace view public.public_availability as
select ar.listing_id,ar.weekday,ar.opens_at,ar.closes_at,ar.timezone
from public.availability_rules ar join public.listings l on l.id=ar.listing_id join public.host_profiles h on h.user_id=l.owner_id
where ar.active and l.status='published' and h.verification_status='approved';
revoke all on public.public_availability from public;
grant select on public.public_availability to anon,authenticated;

create or replace function public.get_booking_private_details(p_booking_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid(); v_booking public.bookings%rowtype; v_listing public.listings%rowtype; v_host public.host_profiles%rowtype;
begin
  if v_user is null then raise exception 'authentication_required' using errcode='28000'; end if;
  select * into v_booking from public.bookings where id=p_booking_id and (creator_id=v_user or host_id=v_user);
  if not found then raise exception 'booking_not_found' using errcode='P0002'; end if;
  if v_booking.payment_status<>'paid' or v_booking.booking_status not in ('confirmed','checked_in','completion_pending','completed','disputed') then raise exception 'private_arrival_details_not_available' using errcode='55000'; end if;
  select * into v_listing from public.listings where id=v_booking.listing_id;
  select * into v_host from public.host_profiles where user_id=v_booking.host_id;
  return jsonb_build_object('id',v_booking.id,'public_code',v_booking.public_code,'booking_status',v_booking.booking_status,'payment_status',v_booking.payment_status,'payout_status',v_booking.payout_status,'starts_at',v_booking.starts_at,'ends_at',v_booking.ends_at,'crew_size',v_booking.crew_size,'production_type',v_booking.production_type,'base_amount_kobo',v_booking.base_amount_kobo,'total_amount_kobo',v_booking.total_amount_kobo,'listing',jsonb_build_object('title',v_listing.title,'city',v_listing.city,'neighbourhood',v_listing.neighbourhood,'exact_address',v_listing.exact_address),'host',jsonb_build_object('public_display_name',v_host.public_display_name));
end;
$$;
revoke all on function public.get_booking_private_details(uuid) from public;
grant execute on function public.get_booking_private_details(uuid) to authenticated;

create or replace function public.submit_listing_for_review(p_listing_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid(); v_listing public.listings%rowtype; v_photo_count integer; v_hours_count integer;
begin
  if v_user is null then raise exception 'authentication_required' using errcode='28000'; end if;
  select * into v_listing from public.listings where id=p_listing_id and owner_id=v_user for update;
  if not found then raise exception 'listing_not_found' using errcode='P0002'; end if;
  if v_listing.status not in ('draft','changes_requested') then raise exception 'listing_not_editable' using errcode='55000'; end if;
  if not exists(select 1 from public.host_profiles where user_id=v_user and host_terms_accepted_at is not null) then raise exception 'host_terms_required' using errcode='55000'; end if;
  select count(*) into v_photo_count from public.listing_photos where listing_id=p_listing_id and source_type='host_upload';
  select count(*) into v_hours_count from public.availability_rules where listing_id=p_listing_id and active;
  if v_photo_count<1 or v_hours_count<1 or nullif(trim(v_listing.description),'') is null then raise exception 'listing_review_requirements_not_met' using errcode='55000'; end if;
  update public.listings set status='submitted',submitted_at=now(),updated_at=now() where id=p_listing_id;
  insert into public.notifications(recipient_id,event_type,payload) select ur.user_id,'listing_submitted',jsonb_build_object('listing_id',p_listing_id) from public.user_roles ur where ur.role='admin';
  return jsonb_build_object('listing_id',p_listing_id,'status','submitted');
end;
$$;
revoke all on function public.submit_listing_for_review(uuid) from public;
grant execute on function public.submit_listing_for_review(uuid) to authenticated;

create or replace function public.register_listing_photo(p_listing_id uuid,p_storage_path text,p_alt_text text,p_is_cover boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid(); v_photo public.listing_photos%rowtype;
begin
  if v_user is null then raise exception 'authentication_required' using errcode='28000'; end if;
  if p_storage_path !~ ('^'||p_listing_id::text||'/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp)$') then raise exception 'invalid_storage_path' using errcode='22023'; end if;
  if not exists(select 1 from public.listings where id=p_listing_id and owner_id=v_user and status in ('draft','changes_requested')) then raise exception 'listing_not_editable' using errcode='55000'; end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='listing-photos' and o.name=p_storage_path and o.owner_id=v_user::text) then raise exception 'listing_photo_upload_not_found' using errcode='P0002'; end if;
  insert into public.listing_photos(listing_id,storage_path,sort_order,is_cover,alt_text,created_by,source_type)
  values(p_listing_id,p_storage_path,(select coalesce(max(sort_order),-1)+1 from public.listing_photos where listing_id=p_listing_id),p_is_cover,left(coalesce(p_alt_text,''),300),v_user,'host_upload') returning * into v_photo;
  if p_is_cover then update public.listing_photos set is_cover=false where listing_id=p_listing_id and id<>v_photo.id; end if;
  return jsonb_build_object('id',v_photo.id,'listing_id',p_listing_id,'moderation_status',v_photo.moderation_status);
end;
$$;
revoke all on function public.register_listing_photo(uuid,text,text,boolean) from public;
grant execute on function public.register_listing_photo(uuid,text,text,boolean) to authenticated;

create or replace function public.admin_resolve_dispute(p_dispute_id uuid,p_decision text,p_reason text,p_refund_amount_kobo bigint default 0)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=auth.uid(); v_dispute public.disputes%rowtype; v_booking public.bookings%rowtype; v_previous_status text; v_next_dispute text;
begin
  if v_actor is null or not public.is_admin() then raise exception 'admin_role_required' using errcode='42501'; end if;
  if p_decision not in ('request_more_evidence','release_payout','refund_full','refund_partial','split') or char_length(trim(p_reason))<5 or p_refund_amount_kobo is null or p_refund_amount_kobo<0 then raise exception 'invalid_dispute_resolution' using errcode='22023'; end if;
  select * into v_dispute from public.disputes where id=p_dispute_id for update;
  if not found or v_dispute.status in ('resolved','closed') then raise exception 'dispute_not_open' using errcode='55000'; end if;
  select * into v_booking from public.bookings where id=v_dispute.booking_id for update;
  if p_decision='request_more_evidence' then
    update public.disputes set status='request_more_evidence',assigned_admin=v_actor,resolution_reason=left(p_reason,2000) where id=p_dispute_id;
    insert into public.admin_audit_log(actor_id,action,target_table,target_id,reason) values(v_actor,'dispute_more_evidence','disputes',p_dispute_id::text,left(p_reason,2000));
    return jsonb_build_object('status','request_more_evidence','fund_movement','none');
  end if;
  if p_refund_amount_kobo>v_booking.total_amount_kobo then raise exception 'refund_exceeds_booking_total' using errcode='22023'; end if;
  if p_decision='refund_full' and p_refund_amount_kobo<>v_booking.total_amount_kobo then raise exception 'full_refund_amount_must_match_booking_total' using errcode='22023'; end if;
  if p_decision in ('refund_partial','split') and (p_refund_amount_kobo<=0 or p_refund_amount_kobo>=v_booking.total_amount_kobo) then raise exception 'partial_refund_amount_invalid' using errcode='22023'; end if;
  if p_decision in ('request_more_evidence','release_payout') and p_refund_amount_kobo<>0 then raise exception 'refund_amount_not_allowed_for_decision' using errcode='22023'; end if;
  if p_decision in ('refund_full','refund_partial','split') then
    update public.payments set status='refund_pending',updated_at=now() where booking_id=v_booking.id and status='paid';
    update public.bookings set payout_status='held',payment_status='refund_pending' where id=v_booking.id;
    v_next_dispute:='resolved';
  else
    select from_status into v_previous_status from public.booking_events where booking_id=v_booking.id and event_type='dispute_opened' order by created_at desc limit 1;
    if v_previous_status<>'completed' then raise exception 'payout_release_requires_completed_session' using errcode='55000'; end if;
    update public.bookings set booking_status='completed',payout_status='held' where id=v_booking.id;
    v_next_dispute:='resolved';
  end if;
  update public.disputes set status=v_next_dispute,assigned_admin=v_actor,resolution=p_decision,resolution_reason=left(p_reason,2000),refund_amount_kobo=p_refund_amount_kobo,payout_decision=case when p_decision='release_payout' then 'eligible_after_configured_delay' else 'held_pending_provider_confirmation' end,resolved_at=now() where id=p_dispute_id;
  insert into public.admin_audit_log(actor_id,action,target_table,target_id,reason,safe_before_after) values(v_actor,'dispute_'||p_decision,'disputes',p_dispute_id::text,left(p_reason,2000),jsonb_build_object('refund_amount_kobo',p_refund_amount_kobo,'provider_action_required',p_decision in ('refund_full','refund_partial','split')));
  insert into public.booking_events(booking_id,actor_id,event_type,from_status,to_status,reason,safe_metadata) values(v_booking.id,v_actor,'dispute_resolved','disputed',case when p_decision='release_payout' then 'completed' else 'disputed' end,left(p_reason,2000),jsonb_build_object('decision',p_decision,'refund_amount_kobo',p_refund_amount_kobo));
  return jsonb_build_object('status','resolved','decision',p_decision,'payment_action',case when p_decision in ('refund_full','refund_partial','split') then 'refund_pending_provider_confirmation' else 'no_immediate_transfer' end);
end;
$$;
revoke all on function public.admin_resolve_dispute(uuid,text,text,bigint) from public;
grant execute on function public.admin_resolve_dispute(uuid,text,text,bigint) to authenticated;

alter table public.otp_sessions add column if not exists issued_by uuid references auth.users(id);

grant insert, delete on public.favorites to authenticated;

create or replace view public.public_platform_settings as
select booking_enabled,payment_enabled,cancellation_policy_approved,cancellation_policy_version,cancellation_policy_text,
  request_expiry_minutes,payment_window_minutes,otp_ttl_minutes,otp_window_before_minutes,otp_window_after_minutes,
  payout_delay_hours,commission_bps,creator_fee_bps,creator_fee_approved
from public.platform_settings where id=true;
revoke all on public.public_platform_settings from public;
grant select on public.public_platform_settings to anon,authenticated;

create or replace view public.public_busy_slots as
select b.listing_id,b.starts_at,b.ends_at
from public.bookings b join public.listings l on l.id=b.listing_id
where l.status='published' and b.booking_status in ('request_pending','accepted_awaiting_payment','payment_pending','confirmed','checked_in','completion_pending','disputed') and b.ends_at>now();
revoke all on public.public_busy_slots from public;
grant select on public.public_busy_slots to anon,authenticated;

create or replace view public.public_availability_exceptions as
select ae.listing_id,ae.starts_at,ae.ends_at
from public.availability_exceptions ae join public.listings l on l.id=ae.listing_id
where l.status='published' and ae.is_blocked and ae.ends_at>now();
revoke all on public.public_availability_exceptions from public;
grant select on public.public_availability_exceptions to anon,authenticated;

create or replace function public.cancel_unpaid_booking(p_booking_id uuid,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid(); v_booking public.bookings%rowtype; v_from text;
begin
  if v_user is null then raise exception 'authentication_required' using errcode='28000'; end if;
  select * into v_booking from public.bookings where id=p_booking_id and (creator_id=v_user or host_id=v_user) for update;
  if not found then raise exception 'booking_not_found' using errcode='P0002'; end if;
  if v_booking.payment_status='paid' or v_booking.booking_status not in ('request_pending','accepted_awaiting_payment','payment_pending') then raise exception 'paid_booking_cancellation_requires_manual_policy_review' using errcode='55000'; end if;
  v_from:=v_booking.booking_status;
  update public.bookings set booking_status='cancelled',updated_at=now() where id=p_booking_id;
  insert into public.booking_events(booking_id,actor_id,event_type,from_status,to_status,reason) values(p_booking_id,v_user,'booking_cancelled',v_from,'cancelled',left(coalesce(p_reason,'Cancelled before verified payment.'),1000));
  insert into public.notifications(recipient_id,event_type,payload) values(v_booking.creator_id,'booking_cancelled',jsonb_build_object('booking_id',p_booking_id)),(v_booking.host_id,'booking_cancelled',jsonb_build_object('booking_id',p_booking_id));
  return jsonb_build_object('booking_id',p_booking_id,'booking_status','cancelled','payment_status',v_booking.payment_status);
end;
$$;
revoke all on function public.cancel_unpaid_booking(uuid,text) from public;
grant execute on function public.cancel_unpaid_booking(uuid,text) to authenticated;

create or replace function public.set_listing_favorite(p_listing_id uuid,p_saved boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid();
begin
  if v_user is null then raise exception 'authentication_required' using errcode='28000'; end if;
  if p_saved then
    if not exists(select 1 from public.public_listings where id=p_listing_id) then raise exception 'listing_not_bookable' using errcode='P0002'; end if;
    insert into public.favorites(creator_id,listing_id) values(v_user,p_listing_id) on conflict do nothing;
  else delete from public.favorites where creator_id=v_user and listing_id=p_listing_id;
  end if;
  return jsonb_build_object('listing_id',p_listing_id,'saved',p_saved);
end;
$$;
revoke all on function public.set_listing_favorite(uuid,boolean) from public;
grant execute on function public.set_listing_favorite(uuid,boolean) to authenticated;

create or replace function public.register_dispute_evidence(p_dispute_id uuid,p_storage_path text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid(); v_id uuid; v_dispute public.disputes%rowtype;
begin
  if v_user is null then raise exception 'authentication_required' using errcode='28000'; end if;
  if p_storage_path !~ ('^'||v_user::text||'/'||p_dispute_id::text||'/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp|pdf)$') then raise exception 'invalid_storage_path' using errcode='22023'; end if;
  select d.* into v_dispute from public.disputes d join public.bookings b on b.id=d.booking_id where d.id=p_dispute_id and (d.opened_by=v_user or b.creator_id=v_user or b.host_id=v_user) for update of d;
  if not found or v_dispute.status in ('resolved','closed') then raise exception 'dispute_not_open' using errcode='55000'; end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='dispute-evidence' and o.name=p_storage_path and o.owner_id=v_user::text) then raise exception 'evidence_upload_not_found' using errcode='P0002'; end if;
  insert into public.dispute_evidence(dispute_id,storage_path,uploaded_by) values(p_dispute_id,p_storage_path,v_user) returning id into v_id;
  return jsonb_build_object('id',v_id,'dispute_id',p_dispute_id);
end;
$$;
revoke all on function public.register_dispute_evidence(uuid,text) from public;
grant execute on function public.register_dispute_evidence(uuid,text) to authenticated;

create or replace function public.register_host_verification_document(p_document_type text,p_storage_path text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid(); v_id uuid;
begin
  if v_user is null then raise exception 'authentication_required' using errcode='28000'; end if;
  if p_document_type not in ('government_id','proof_of_address','ownership_authorization','other') then raise exception 'invalid_document_type' using errcode='22023'; end if;
  if p_storage_path !~ ('^'||v_user::text||'/[A-Za-z0-9_-]+\.(jpg|jpeg|png|webp|pdf)$') then raise exception 'invalid_storage_path' using errcode='22023'; end if;
  if not exists(select 1 from public.host_profiles where user_id=v_user) then raise exception 'host_onboarding_required' using errcode='55000'; end if;
  if not exists(select 1 from storage.objects o where o.bucket_id='verification-documents' and o.name=p_storage_path and o.owner_id=v_user::text) then raise exception 'verification_document_upload_not_found' using errcode='P0002'; end if;
  insert into public.host_verification_documents(host_user_id,storage_path,document_type,uploaded_by) values(v_user,p_storage_path,p_document_type,v_user) returning id into v_id;
  return jsonb_build_object('id',v_id,'review_status','pending');
end;
$$;
revoke all on function public.register_host_verification_document(text,text) from public;
grant execute on function public.register_host_verification_document(text,text) to authenticated;

create or replace function public.issue_booking_otp(p_booking_id uuid,p_code_hash text,p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_user uuid:=auth.uid(); v_booking public.bookings%rowtype; v_ttl int; v_before int; v_after int; v_issued int;
begin
  if v_user is null then raise exception 'authentication_required' using errcode='28000'; end if;
  select * into v_booking from public.bookings where id=p_booking_id and creator_id=v_user for update;
  if not found or v_booking.booking_status<>'confirmed' or v_booking.payment_status<>'paid' then raise exception 'booking_not_eligible_for_otp' using errcode='55000'; end if;
  select otp_ttl_minutes,otp_window_before_minutes,otp_window_after_minutes into v_ttl,v_before,v_after from public.platform_settings where id=true;
  if v_ttl is null or v_ttl<1 or v_before is null or v_after is null then raise exception 'otp_window_not_configured' using errcode='55000'; end if;
  if p_expires_at<=now() or p_expires_at>now()+make_interval(mins=>v_ttl) then raise exception 'invalid_otp_expiry' using errcode='22023'; end if;
  if now()<v_booking.starts_at-make_interval(mins=>v_before) or now()>v_booking.ends_at+make_interval(mins=>v_after) then raise exception 'outside_checkin_window' using errcode='55000'; end if;
  select count(*) into v_issued from public.otp_sessions where issued_by=v_user and issued_at>now()-interval '1 hour';
  if v_issued>=5 or exists(select 1 from public.otp_sessions where issued_by=v_user and booking_id=p_booking_id and issued_at>now()-interval '1 minute') then raise exception 'otp_issue_rate_limited' using errcode='55000'; end if;
  update public.otp_sessions set expires_at=now(),locked_at=coalesce(locked_at,now()) where booking_id=p_booking_id and used_at is null and locked_at is null;
  insert into public.otp_sessions(booking_id,issued_by,code_hash,expires_at,max_attempts) values(p_booking_id,v_user,p_code_hash,p_expires_at,5);
  insert into public.booking_events(booking_id,actor_id,event_type,to_status) values(p_booking_id,v_user,'checkin_code_issued',v_booking.booking_status);
  return jsonb_build_object('expires_at',p_expires_at);
end;
$$;
revoke all on function public.issue_booking_otp(uuid,text,timestamptz) from public;
grant execute on function public.issue_booking_otp(uuid,text,timestamptz) to authenticated;

create or replace function public.create_contact_request(p_full_name text,p_email text,p_phone text,p_subject text,p_message text,p_ip_fingerprint text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(coalesce(p_ip_fingerprint,'unknown'),0));
  if char_length(trim(p_full_name))<2 or char_length(trim(p_email))<5 or char_length(trim(p_subject))<2 or char_length(trim(p_message))<10 then raise exception 'invalid_contact_request' using errcode='22023'; end if;
  if (select count(*) from public.contact_requests where ip_fingerprint=p_ip_fingerprint and created_at>now()-interval '1 hour')>=5 then raise exception 'contact_rate_limited' using errcode='55000'; end if;
  insert into public.contact_requests(full_name,email,phone,subject,message,ip_fingerprint)
  values(left(trim(p_full_name),120),lower(left(trim(p_email),254)),left(trim(coalesce(p_phone,'')),40),left(trim(p_subject),160),left(trim(p_message),10000),p_ip_fingerprint) returning id into v_id;
  return jsonb_build_object('id',v_id);
end;
$$;
revoke all on function public.create_contact_request(text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.create_contact_request(text,text,text,text,text,text) to service_role;

-- Admin role must be granted manually through a private owner-controlled database session.
-- Do not add admin assignment to signup triggers, client APIs or public forms.
