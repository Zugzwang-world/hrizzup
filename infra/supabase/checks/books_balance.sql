-- Checks a real database (staging, after its migrations; production, from the release
-- pipeline) the way the Database check checks a fresh one: the markets' books have no problem
-- (ledger.problems(), PLAN.md step 1.7b). They sum to zero, every balance equals its lines,
-- every share is backed by Ṁ1 in its market, every settled market holds nothing, and nobody
-- is below zero but through a cancelled market.
-- Read-only. Fails (and stops psql with ON_ERROR_STOP) if any problem is found.
do $$
declare
  found int;
  first text;
begin
  select count(*), min(problem) into found, first from ledger.problems();
  if found > 0 then
    raise exception '% problem(s) in the markets'' books; the first: %', found, first;
  end if;
  raise notice 'The markets'' books sum to zero, and every balance equals its lines';
end;
$$;
