-- Unlisted markets (Round 4, relay R2: every check run on its own; the founder's decisions of 10
-- November 2026: each check run owns what it changes, and a run's markets stay off staging's public
-- list). As on Manifold, whose markets can be unlisted: an unlisted market is made, opened, traded,
-- closed and settled like any other, by its address, but it never shows in the public list. The
-- checks make their test markets unlisted. Database changes land first: the typed API's create call
-- and the console follow in the next pull request.
--
-- What this adds:
--   1. markets.details.listed: whether the market shows in the public list. True for every market
--      made so far and by default, false only when its admin makes it unlisted; chosen when the
--      market is made and never changed after, so a market never appears in, or vanishes from, the
--      list behind anyone's back.
--   2. admin.create_market(..., listed): the console's create call with the choice, and a retry
--      that asks for the other choice is refused as another market. The call with ten arguments
--      still makes a listed market, exactly as before.
--   3. The public list (trading.markets) leaves unlisted markets out, with an index so it never
--      walks past them. Everything else reads them as before: trading by address, a person's own
--      positions and orders, and the console, which now says whether each market is listed.
--   4. The markets the checks made before this come off the public list, once (on staging, every
--      market so far; on production, none).


-- 1. Whether a market is listed --------------------------------------------------------------------

alter table markets.details add column listed boolean not null default true;
comment on column markets.details.listed is
  'Whether the market shows in the public list (trading.markets): true unless its admin made it '
  'unlisted, as the checks'' test markets are. Chosen when it''s made, never changed after.';

-- The markets the checks made before this come off the public list too, as every check run's markets
-- now do: on staging, every market so far (the console's test account made all of them; none is
-- anyone else's). Where that account doesn't exist (production, and the throwaway database the
-- Database check builds), nothing changes. Done here, before the rule below that a market's listing
-- never changes, so it's the one time it does.
--   d0606352-12bf-4f3c-bcc7-9fbbce431a3a  the market console's test account on staging,
--     delivered+market-admin@resend.dev (migrations/*_staging_admins.sql)
update markets.details set listed = false
where created_by = 'd0606352-12bf-4f3c-bcc7-9fbbce431a3a';
-- The update queued the details' check across tables (a constraint trigger put off to the end of
-- the transaction), and Postgres makes no index or trigger on a table with checks still queued.
-- Run that check now, then put it back to its usual time (found by the AI review; reproduced on
-- staging-like data before the fix).
set constraints markets.details_rules_across_tables immediate;
set constraints markets.details_rules_across_tables deferred;

create function markets.keep_listing()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.listed is distinct from old.listed then
    raise exception 'Whether market % is listed is chosen when it''s made, never changed after',
      old.market_id using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
create trigger details_listing_never_changes
  before update of listed on markets.details
  for each row execute function markets.keep_listing();

-- The public list walks the listed markets newest first, never the unlisted ones in between.
create index details_listed on markets.details (market_id desc) where listed;


-- 2. Making a market listed or unlisted ------------------------------------------------------------

create function admin.create_market(
  market uuid,
  question text,
  categories text[],
  rules text,
  source_name text,
  source_url text,
  opens_at timestamptz,
  closes_at timestamptz,
  probability numeric,
  seed numeric,
  listed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid := private.signed_in_admin();
  made_at timestamptz := date_trunc('milliseconds', clock_timestamp());
  account uuid;
  existing markets.details;
begin
  if create_market.market is null or uuid_extract_version(create_market.market) is distinct from 7 then
    raise exception 'A market''s ID is a version 7 UUID' using errcode = 'invalid_parameter_value';
  end if;
  if create_market.listed is null then
    raise exception 'A market is listed or unlisted' using errcode = 'invalid_parameter_value';
  end if;

  -- One market per ID, even when a retry arrives while the first try is still running.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin.create_market:' || create_market.market::text, 0));
  select * into existing from markets.details d where d.market_id = create_market.market;
  if found then
    if existing.created_by = who and existing.question = create_market.question
       and existing.listed = create_market.listed then
      return markets.console_view(create_market.market, true);
    end if;
    raise exception 'Market ID % is already used for another market', create_market.market
      using errcode = 'unique_violation';
  end if;
  if exists (select 1 from markets.markets m where m.id = create_market.market) then
    raise exception 'Market ID % is already used for another market', create_market.market
      using errcode = 'unique_violation';
  end if;

  if create_market.categories is null
     or cardinality(create_market.categories) not between 1 and 3
     or array_ndims(create_market.categories) <> 1
     or (select count(distinct c) from unnest(create_market.categories) as c)
        <> cardinality(create_market.categories)
     or exists (
          select 1 from unnest(create_market.categories) as c
          where c is null or c <> all (enum_range(null::agreement.category)::text[])) then
    raise exception 'A market has 1 to 3 categories from the list, none repeated'
      using errcode = 'invalid_parameter_value';
  end if;
  if create_market.closes_at is null or create_market.closes_at <= made_at then
    raise exception 'A market closes in the future' using errcode = 'invalid_parameter_value';
  end if;
  if create_market.opens_at is null or create_market.opens_at >= create_market.closes_at then
    raise exception 'A market opens before it closes' using errcode = 'invalid_parameter_value';
  end if;
  if create_market.probability is null
     or create_market.probability < 0.01 or create_market.probability > 0.99
     or create_market.probability <> round(create_market.probability, 8) then
    raise exception 'A market starts between 1%% and 99%%, to at most 8 decimal places'
      using errcode = 'invalid_parameter_value';
  end if;
  if create_market.seed is null or create_market.seed <= 0 or create_market.seed > 1000000
     or create_market.seed <> round(create_market.seed, 6) then
    raise exception 'The house seeds a market with more than Ṁ0 and at most Ṁ1,000,000, to the millionth'
      using errcode = 'invalid_parameter_value';
  end if;

  insert into ledger.accounts (kind) values ('market') returning id into account;
  insert into markets.markets (id, account_id, state, closes_at, p, pool_yes, pool_no, seed,
                               created_at, updated_at)
  values (create_market.market, account, 'draft', create_market.closes_at,
          create_market.probability, 0, 0, create_market.seed, made_at, made_at);
  insert into markets.details (market_id, question, categories, kind, rules, source_name,
                               source_url, settlement, opens_at, created_by, listed)
  values (create_market.market, create_market.question,
          create_market.categories::agreement.category[], 'yes_no', create_market.rules,
          create_market.source_name, create_market.source_url, 'by_hand', create_market.opens_at,
          who, create_market.listed);
  insert into markets.log (market_id, action, by_account, at)
  values (create_market.market, 'create', who, made_at);
  return markets.console_view(create_market.market, true);
end;
$$;


create or replace function admin.create_market(
  market uuid,
  question text,
  categories text[],
  rules text,
  source_name text,
  source_url text,
  opens_at timestamptz,
  closes_at timestamptz,
  probability numeric,
  seed numeric
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select admin.create_market(market, question, categories, rules, source_name, source_url,
                             opens_at, closes_at, probability, seed, true);
$$;


-- 3. The public list leaves unlisted markets out ---------------------------------------------------

create or replace function trading.markets(after_market uuid, max_count integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ids uuid[];
begin
  if max_count is null or max_count not between 1 and 100 then
    raise exception 'A page holds 1 to 100 markets' using errcode = 'invalid_parameter_value';
  end if;
  select coalesce(array_agg(x.id order by x.id desc), '{}') into ids
  from (
    select m.id
    from markets.markets m
    join markets.details d on d.market_id = m.id
    where m.state <> 'draft'
      and d.listed
      and m.resolution is distinct from 'MKT'
      and (after_market is null or m.id < after_market)
    order by m.id desc
    limit max_count + 1
  ) x;
  return jsonb_build_object(
    'markets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'market', markets.market_record(m.id),
        'probability', case when m.state in ('open', 'closed')
                            then markets.probability(m.p, m.pool_yes, m.pool_no)::text end
      ) order by i.n)
      from unnest(ids[1:max_count]) with ordinality as i (id, n)
      join markets.markets m on m.id = i.id
    ), '[]'::jsonb),
    'next', case when cardinality(ids) > max_count then ids[max_count] end
  );
end;
$$;



-- 4. The console says whether a market is listed -----------------------------------------------------

create or replace function markets.console_view(market_id uuid, with_log boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', d.market_id,
    'question', d.question,
    'categories', to_jsonb(d.categories),
    'kind', d.kind,
    'rules', d.rules,
    'source', jsonb_strip_nulls(jsonb_build_object('name', d.source_name, 'url', d.source_url)),
    'settlement', d.settlement,
    'opens_at', markets.utc(d.opens_at),
    'closes_at', markets.utc(m.closes_at),
    'state', m.state,
    'resolution', m.resolution,
    'resolution_probability', m.resolution_probability::text,
    'cancel_reason', d.cancel_reason,
    'settled_at', markets.utc(m.settled_at),
    'created_at', markets.utc(m.created_at),
    'updated_at', markets.utc(m.updated_at),
    'created_by', jsonb_build_object(
      'id', d.created_by,
      'email', (select u.email from auth.users u where u.id = d.created_by)),
    'starting_probability', m.p::text,
    'seed', m.seed::text,
    'pool', jsonb_build_object('yes', m.pool_yes::text, 'no', m.pool_no::text),
    'probability', case when m.state in ('open', 'closed')
                        then markets.probability(m.p, m.pool_yes, m.pool_no)::text end,
    'held', a.balance::text,
    'trades', m.trades,
    'listed', d.listed,
    'log', case when with_log then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'action', l.action,
        'at', markets.utc(l.at),
        'by', jsonb_build_object(
          'id', l.by_account,
          'email', (select u.email from auth.users u where u.id = l.by_account)),
        'outcome', l.outcome,
        'probability', l.probability::text,
        'evidence', l.evidence,
        'reason', l.reason,
        'paid_to_people', l.paid_to_people::text,
        'people', l.people,
        'to_house', l.to_house::text
      ) order by l.id)
      from markets.log l
      where l.market_id = d.market_id
    ), '[]'::jsonb) end
  )
  from markets.details d
  join markets.markets m on m.id = d.market_id
  join ledger.accounts a on a.id = m.account_id
  where d.market_id = console_view.market_id;
$$;



-- Who may call what: the new call as the console's others; nothing else changes.
revoke all on function markets.keep_listing() from public;
revoke all on function
  admin.create_market(uuid, text, text[], text, text, text, timestamptz, timestamptz, numeric, numeric, boolean)
  from public, anon, authenticated, service_role;
grant execute on function
  admin.create_market(uuid, text, text[], text, text, text, timestamptz, timestamptz, numeric, numeric, boolean)
  to hrizzup_app;
