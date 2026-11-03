-- Checks a real database (staging, after its migrations; production, from the release
-- pipeline) the same way the pull-request tests check a fresh one: the safeguard that
-- locks new tables is on, and no table of ours is without row-level security.
-- Read-only. Fails (and stops psql with ON_ERROR_STOP) if either is untrue.
do $$
declare
  missing int;
  names text;
begin
  if not exists (
    select 1 from pg_catalog.pg_event_trigger
    where evtname = 'lock_new_tables' and evtenabled = 'O'
  ) then
    raise exception 'The safeguard that locks new tables (event trigger lock_new_tables) is missing or off';
  end if;

  select count(*), string_agg(table_name, ', ') into missing, names
  from private.unprotected_tables();
  if missing > 0 then
    raise exception '% table(s) without row-level security: %', missing, names;
  end if;

  raise notice 'Every table has row-level security, and the safeguard that locks new tables is on';
end;
$$;
