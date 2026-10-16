-- Creator ratings (3 to 5 stars) and a top-rated leaderboard.
-- Owner decisions confirmed 2026-10-16:
--   1. Ratings allowed: 3, 4 or 5 only.
--   2. Ratings publish immediately when submitted; an admin can hide one later (audited).
--   3. Ranking: average stars, but a space needs at least 3 ratings to rank above
--      spaces with fewer. Ties: more ratings first, then newest rating.
--   4. Leaderboard: a "Top rated" section on Explore (default Explore order is unchanged).
-- This migration moves no money and calls no payment provider.

-- 1) Ratings are 3 to 5 only. Existing rows below 3 (if any) are never deleted: the new
--    constraint is added NOT VALID first and validated only if no stored row violates it.
--    Check afterwards with:
--      select conname, convalidated from pg_constraint
--      where conrelid = 'public.reviews'::regclass and contype = 'c' and conname = 'reviews_rating_check';
alter table public.reviews drop constraint if exists reviews_rating_check;
alter table public.reviews add constraint reviews_rating_check check (rating between 3 and 5) not valid;
do $$
begin
  if not exists (select 1 from public.reviews where rating < 3) then
    alter table public.reviews validate constraint reviews_rating_check;
  end if;
end $$;

create index if not exists reviews_listing_published_idx
  on public.reviews(listing_id, created_at desc)
  where moderation_status = 'published';

-- 2) submit_review: the supported path for a creator to rate a completed session.
--    All rules are enforced here so they do not depend on the client. New ratings are
--    published immediately (owner decision); an admin can hide one with admin_hide_review.
create or replace function public.submit_review(p_booking_id uuid, p_rating int, p_body text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_booking public.bookings%rowtype; v_review public.reviews%rowtype;
begin
  if v_user is null then raise exception 'authentication_required' using errcode='28000'; end if;
  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'booking_not_found' using errcode='P0002'; end if;
  if v_booking.creator_id <> v_user then raise exception 'review_not_for_your_booking' using errcode='42501'; end if;
  -- The dispute check runs before the status checks so a disputed booking reports the
  -- dispute (opening a dispute moves the booking out of 'completed').
  if exists (select 1 from public.disputes d where d.booking_id = p_booking_id and d.status not in ('resolved','closed')) then raise exception 'review_blocked_by_open_dispute' using errcode='55000'; end if;
  if v_booking.booking_status <> 'completed' then raise exception 'review_requires_completed_booking' using errcode='55000'; end if;
  -- payment_status is a single value, so requiring exactly 'paid' also excludes
  -- refund_pending, partially_refunded and refunded bookings.
  if v_booking.payment_status <> 'paid' then raise exception 'review_requires_paid_booking' using errcode='55000'; end if;
  if p_rating is null or p_rating < 3 or p_rating > 5 then raise exception 'review_rating_out_of_range' using errcode='22023'; end if;
  if char_length(coalesce(p_body, '')) > 1000 then raise exception 'review_body_too_long' using errcode='22023'; end if;
  -- The unique (booking_id, reviewer_id) key also enforces this; the pre-check gives a friendly code.
  if exists (select 1 from public.reviews r where r.booking_id = p_booking_id and r.reviewer_id = v_user) then raise exception 'review_already_submitted' using errcode='23P01'; end if;
  insert into public.reviews(booking_id, reviewer_id, listing_id, rating, body, moderation_status)
  values (p_booking_id, v_user, v_booking.listing_id, p_rating::smallint, left(coalesce(p_body, ''), 1000), 'published')
  returning * into v_review;
  return jsonb_build_object('review_id', v_review.id, 'listing_id', v_review.listing_id, 'rating', v_review.rating, 'moderation_status', v_review.moderation_status);
end;
$$;
revoke all on function public.submit_review(uuid, int, text) from public;
grant execute on function public.submit_review(uuid, int, text) to authenticated;

-- 3) Admins can hide a published rating later. Audited like the other admin_* functions.
--    Hiding sets moderation_status='rejected', which removes it from every public read path
--    (public_listings averages, /api/reviews and listing_rankings) without deleting the row.
create or replace function public.admin_hide_review(p_review_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid(); v_review public.reviews%rowtype;
begin
  if v_actor is null then raise exception 'authentication_required' using errcode='28000'; end if;
  if not public.is_admin() then raise exception 'admin_role_required' using errcode='42501'; end if;
  select * into v_review from public.reviews where id = p_review_id for update;
  if not found then raise exception 'review_not_found' using errcode='P0002'; end if;
  update public.reviews set moderation_status = 'rejected' where id = p_review_id;
  insert into public.admin_audit_log(actor_id, action, target_table, target_id, reason, safe_before_after)
  values (v_actor, 'review_hidden', 'reviews', p_review_id::text, left(p_reason, 2000),
          jsonb_build_object('from', v_review.moderation_status, 'to', 'rejected'));
  return jsonb_build_object('review_id', p_review_id, 'moderation_status', 'rejected');
end;
$$;
revoke all on function public.admin_hide_review(uuid, text) from public;
grant execute on function public.admin_hide_review(uuid, text) to authenticated;

-- 4) Top-rated leaderboard. Only fully public listings (published, host approved, approved
--    photos - the same rule as public_listings) with at least one published rating are ranked.
--    Ranking rule: spaces with 3 or more ratings rank above spaces with fewer, then higher
--    average first, then more ratings first, then the newest rating first.
create or replace view public.listing_rankings as
with rated as (
  select r.listing_id,
         avg(r.rating) as avg_rating,
         count(*)::integer as rating_count,
         max(r.created_at) as latest_rating_at
  from public.reviews r
  where r.moderation_status = 'published'
  group by r.listing_id
)
select
  pl.id as listing_id,
  round(rd.avg_rating::numeric, 1) as average_rating,
  rd.rating_count,
  rd.latest_rating_at,
  row_number() over (
    order by (case when rd.rating_count >= 3 then 1 else 0 end) desc,
             rd.avg_rating desc,
             rd.rating_count desc,
             rd.latest_rating_at desc
  )::integer as rank
from rated rd
join public.public_listings pl on pl.id = rd.listing_id;
revoke all on public.listing_rankings from public;
grant select on public.listing_rankings to anon, authenticated;
