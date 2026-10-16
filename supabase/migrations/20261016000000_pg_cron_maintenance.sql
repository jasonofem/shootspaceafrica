-- Scheduled marketplace maintenance inside Supabase (free-plan friendly).
-- Runs every 15 minutes in UTC. It only calls two existing, idempotent functions:
--   expire_stale_bookings()  -> marks lapsed booking requests/payment windows as expired
--   release_mature_payouts() -> marks payouts eligible after the configured delay, unless disputed
-- It does not transfer money, does not set payments live, and needs no secrets.

create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'marketplace-maintenance') then
    perform cron.unschedule('marketplace-maintenance');
  end if;
end $$;

select cron.schedule(
  'marketplace-maintenance',
  '*/15 * * * *',
  $$ select public.expire_stale_bookings(); select public.release_mature_payouts(); $$
);
