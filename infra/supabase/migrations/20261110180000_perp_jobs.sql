-- The perp's scheduled jobs (PLAN.md step 3.4a; scheduled jobs are defined in migrations, the
-- founder's decision of 10 November 2026): Supabase Cron (pg_cron, inside the database) runs them,
-- and each calls the website's jobs address (product/web/app/api/jobs/perps) through pg_net, where
-- the server runs the same steps as a trade, with the same engine code: never a second copy of the
-- perp's maths here.
--
-- - Every 5 seconds, `tick`: the next stand-in price, with the liquidation check it brings.
-- - Every minute, `funding`: the hourly funding, for each perp whose hourly slot has come round
--   (perps.next_funding_at: each perp is funded once a period, an hour by default, on slots of its
--   own, so a run comes within a minute of its slot and the next stays on the hour).
-- - Each step happens once even if runs overlap: the database applies a price once a 5-second step
--   and funding once a period, and a tick skips a perp another step holds (perps.begin_step).
-- - Nothing runs while a perp is off: a run first asks perps.due, which lists only the perps that
--   are switched on and have an open position (a check run's test perp only for its first two
--   hours), and makes no call at all when it lists none.
-- - Inside the current plans: Supabase Cron, pg_net and Vault come with every Supabase plan, at no
--   extra cost, and the website is called only while a perp is on with someone holding a position:
--   at most 17,280 calls a day for the ticks, inside Vercel Pro's included function calls (a
--   million a month). A perp switched off, as production's is, makes no call.
-- - Where to call, and the secret the call carries, are each environment's own, in Supabase Vault
--   (`perps_jobs_url`, `perps_jobs_secret`, set by infra/supabase/perps_jobs.py from Doppler's
--   PERP_JOBS_SECRET). Where they aren't set (this Mac, a check's fresh database, production while
--   its perp is off), a run calls nothing, and the listed perp can't be switched on.
-- - pg_net comes with Supabase's own grants, which let any database role use it and read its
--   request queue (where a call's secret waits a moment before it's sent); only Supabase's admin
--   can change them. With the Data API off, only our app's role reaches SQL, and the secret only
--   starts a job run, which is harmless (docs/status/product.md, Open questions).

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- One run of a job: a call to the website's jobs address when there's work and somewhere to call;
-- null otherwise. Gives back pg_net's request ID (the call itself is sent, and its answer kept for a
-- few hours, by pg_net's own worker, after this run's transaction commits).
create function perps.call_job(job text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  address text;
  secret text;
begin
  if call_job.job is null or call_job.job not in ('tick', 'funding') then
    raise exception 'Unknown perp job %', call_job.job using errcode = 'invalid_parameter_value';
  end if;
  -- No work, no call: no perp switched on with an open position (and, for funding, due).
  if cardinality(perps.due(call_job.job)) = 0 then
    return null;
  end if;
  select s.decrypted_secret into address from vault.decrypted_secrets s where s.name = 'perps_jobs_url';
  select s.decrypted_secret into secret from vault.decrypted_secrets s where s.name = 'perps_jobs_secret';
  if address is null or secret is null then
    return null;
  end if;
  return net.http_post(
    url := address,
    params := jsonb_build_object('job', call_job.job),
    headers := jsonb_build_object('Authorization', 'Bearer ' || btrim(secret),
                                  'Content-Type', 'application/json'),
    timeout_milliseconds := 25000
  );
end;
$$;
comment on function perps.call_job(text) is
  'One run of the perp''s scheduled job (tick or funding): calls the website''s jobs address when a '
  'perp has work and the environment''s address and secret are in Vault; otherwise nothing.';

-- Only the schedule runs it (as the database's owner, who made it): never the app or Supabase's roles.
revoke all on function perps.call_job(text) from public, anon, authenticated, service_role;
revoke all on function perps.call_job(text) from hrizzup_app;

select cron.schedule('perps-tick', '5 seconds', $$select perps.call_job('tick')$$);
select cron.schedule('perps-funding', '* * * * *', $$select perps.call_job('funding')$$);
-- Supabase Cron logs every run (about 18,700 a day with these two): kept for two days, then tidied.
select cron.schedule(
  'perps-cron-history',
  '23 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '2 days'$$
);
