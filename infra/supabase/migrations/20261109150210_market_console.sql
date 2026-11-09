-- Markets as data, the admins table, the market log and the market console's calls (PLAN.md
-- step 1.7c; blueprint sections 5 and 13; the founder's decisions of 9 November 2026).
--
-- Database changes land first: nothing calls these yet. The typed API's calls (create, open,
-- close and settle) and the console follow in the next pull requests. Nothing here changes how a
-- trade or a settlement moves money: a settlement still runs through the ledger's own
-- markets.settle (step 1.7b), now inside the console's call, which checks the admins table and
-- logs it.
--
-- What this adds:
--   1. The admins table (private.admins): the accounts that may create, open, close and settle
--      markets. Written only by reviewed migrations naming the account's ID, each adding its row
--      only where that account exists. No role the app or Supabase uses can read or write it.
--      This migration adds no row.
--   2. Markets as data: each market's question, categories, kind, rules, named settlement
--      source, how it settles, opening time and, once cancelled, why (markets.details), beside
--      the ledger's trading state (markets.markets: its state, closing time, pool and result), so
--      every market the console makes holds the agreement's market shape (market/1). The
--      categories are the content store's own list (agreement.category, step 1.9), and the text
--      follows the agreement's building blocks (agreement.one_line, agreement.plain_text,
--      agreement.web_address). markets.market_record() reads a market back as its market/1 record.
--   3. Drafts: a draft holds no money. Its pool is empty until it opens, when the house seeds it.
--      This is the one rule of the ledger's that changes: a pool above zero on both sides, now in
--      every state but draft.
--   4. The market log (markets.log): every create, open, close and settlement, with who and when,
--      and for a settlement the outcome, the evidence and what it paid. Never edited or deleted.
--   5. The console's calls (schema admin): is_admin, markets, market, create_market, open_market,
--      close_market and settle_market. Each checks that the signed-in account (auth.uid(), which
--      the server's database helper sets) is an admin before it reads or writes anything else.
--      The app's own role may call these, and nothing else new.
--
-- Only yes-or-no markets are made and opened: the engine's maths trades no other kind yet (step
-- 1.7a). The details have room for a multiple-choice market's outcomes, as the agreement's shape
-- does, but nothing writes one yet, and one can never leave draft.


-- 1. Admins ---------------------------------------------------------------------------------------

create table private.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note text not null,
  added_at timestamptz not null default now(),
  constraint admins_note_length check (char_length(note) between 1 and 200)
);
comment on table private.admins is
  'Hrizzup''s admins: the accounts that may create, open, close and settle markets (the market '
  'console, PLAN.md step 1.7c). Written only by reviewed migrations naming the account''s ID, each '
  'adding its row only where that account exists. No role the app uses can read or write it; the '
  'database checks it on every create, open, close and settle.';
comment on column private.admins.note is 'Whose account it is, in a few words.';
revoke all on table private.admins from public, anon, authenticated, service_role, hrizzup_app;

-- Whether an account is an admin.
create function private.is_admin(account uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select account is not null
     and exists (select 1 from private.admins a where a.user_id = account);
$$;

-- The signed-in account (auth.uid(), which the server's database helper sets), when it's an
-- admin. Anyone else is refused before anything else is read or written.
create function private.signed_in_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  who uuid := auth.uid();
begin
  if not private.is_admin(who) then
    raise exception 'Only an admin may do this' using errcode = 'insufficient_privilege';
  end if;
  return who;
end;
$$;

revoke all on function private.is_admin(uuid) from public;
revoke all on function private.signed_in_admin() from public;


-- 2 and 3. Markets as data, and drafts -------------------------------------------------------------

-- A draft holds no money yet, so its pool is empty; once a market opens, both sides of its pool
-- stay above zero, as the ledger has always had it.
alter table markets.markets drop constraint markets_pool;
alter table markets.markets add constraint markets_pool check (
  case when state = 'draft' then pool_yes = 0 and pool_no = 0
       else pool_yes > 0 and pool_no > 0 end
);

-- A multiple-choice market's outcomes, as the agreement writes them (market.v1.schema.json,
-- "outcomes"): 2 to 20, each a code (unique within the market, at most 40 characters) and a
-- label (one line of plain text, at most 60 characters), and nothing else.
create function markets.is_outcome_list(outcomes jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  item jsonb;
  codes text[] := '{}';
begin
  if jsonb_typeof(outcomes) <> 'array' or jsonb_array_length(outcomes) not between 2 and 20 then
    return false;
  end if;
  for item in select value from jsonb_array_elements(outcomes) loop
    if jsonb_typeof(item) <> 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(item) as k)
          is distinct from array['code', 'label']
       or jsonb_typeof(item -> 'code') <> 'string'
       or jsonb_typeof(item -> 'label') <> 'string'
       or (item ->> 'code') !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
       or char_length(item ->> 'code') > 40
       or char_length(item ->> 'label') > 60
       or (item ->> 'code') = any (codes) then
      return false;
    end if;
    -- A label is one line of plain text, by the agreement's own building block (which refuses it
    -- otherwise, naming its rule).
    perform (item ->> 'label')::agreement.one_line;
    codes := codes || (item ->> 'code');
  end loop;
  return true;
end;
$$;

create table markets.details (
  market_id agreement.record_id primary key references markets.markets (id),
  question agreement.one_line not null
    constraint details_question_length check (char_length(question) <= 120),
  categories agreement.category[] not null
    constraint details_categories_list check (agreement.is_list(categories, 3)),
  kind text not null
    constraint details_kind_values check (kind in ('yes_no', 'multiple_choice')),
  outcomes jsonb
    constraint details_outcomes_list check (markets.is_outcome_list(outcomes)),
  rules agreement.plain_text not null
    constraint details_rules_length check (char_length(rules) <= 2000),
  source_name agreement.one_line not null
    constraint details_source_name_length check (char_length(source_name) <= 120),
  source_url agreement.web_address,
  settlement text not null
    constraint details_settlement_values check (settlement in ('by_hand', 'automatic')),
  opens_at agreement.time not null,
  cancel_reason agreement.one_line
    constraint details_cancel_reason_length check (char_length(cancel_reason) <= 200),
  created_by uuid not null,
  constraint details_outcomes_only_for_multiple_choice
    check ((kind = 'multiple_choice') = (outcomes is not null))
);
comment on table markets.details is
  'What makes a market a question people can bet on (the agreement''s market shape, market/1): its '
  'question, categories, kind, rules, named settlement source, how it settles, when it opens and, '
  'once cancelled, why. Its state, closing time, pool and result are the ledger''s '
  '(markets.markets). Written only through the console''s calls (schema admin).';
comment on column markets.details.categories is
  'The categories whose news shows alongside the market, the main one first: 1 to 3, none '
  'repeated, from the content store''s own list (agreement.category).';
comment on column markets.details.opens_at is
  'When betting opens: planned while it''s a draft, and the moment it opened once it has.';
comment on column markets.details.cancel_reason is
  'Why the market was cancelled, in our own words: exactly when it''s cancelled.';
comment on column markets.details.created_by is
  'The admin who created the market: their account''s ID, kept as a record (no foreign key), so '
  'the account can still be removed one day without rewriting the market''s history.';

-- The rules that span a market's details and its trading state, checked when the transaction
-- commits (so a call can change both in any order): a market opens no later than it closes; it
-- gives a cancel reason exactly when it's cancelled; and only a yes-or-no market leaves draft.
create function markets.check_details()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- The market's ID: `market_id` on its details, `id` on the market (read through jsonb, since a
  -- trigger function can't name a field the other table doesn't have).
  target uuid := coalesce(to_jsonb(new) ->> 'market_id', to_jsonb(new) ->> 'id')::uuid;
  m markets.markets;
  d markets.details;
begin
  select * into d from markets.details x where x.market_id = target;
  if not found then
    return null; -- One of the ledger's own test markets (step 1.7b), with no details.
  end if;
  select * into m from markets.markets x where x.id = target;
  if d.opens_at > m.closes_at then
    raise exception using
      errcode = '23514', schema = 'markets', table = 'details',
      constraint = 'details_opens_before_it_closes',
      message = format('Market %s would open after it closes', target);
  end if;
  if (m.state = 'cancelled') <> (d.cancel_reason is not null) then
    raise exception using
      errcode = '23514', schema = 'markets', table = 'details',
      constraint = 'details_cancel_reason_only_when_cancelled',
      message = format('Market %s gives a cancel reason exactly when it''s cancelled', target);
  end if;
  if d.kind <> 'yes_no' and m.state <> 'draft' then
    raise exception using
      errcode = '23514', schema = 'markets', table = 'details',
      constraint = 'details_only_yes_no_opens',
      message = format('Market %s isn''t yes-or-no, so it stays a draft', target);
  end if;
  return null;
end;
$$;

create constraint trigger details_rules_across_tables
  after insert or update on markets.details
  deferrable initially deferred
  for each row execute function markets.check_details();
create constraint trigger markets_rules_across_tables
  after update of state, closes_at on markets.markets
  deferrable initially deferred
  for each row execute function markets.check_details();

-- A moment as the agreement writes it: UTC, with no more decimals than it needs.
create function markets.utc(moment timestamptz)
returns text
language sql
stable
strict
set search_path = ''
as $$
  select regexp_replace(
    to_char(moment at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), '\.?0+$', ''
  ) || 'Z';
$$;

-- A market as the agreement's market/1 record, with the fields it leaves out left out. A market
-- settled at a set probability has none: market/1 can say only which outcome won (the Product
-- brief's open questions).
create function markets.market_record(market_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'format', 'market/1',
    'id', d.market_id,
    'question', d.question,
    'categories', to_jsonb(d.categories),
    'kind', d.kind,
    'outcomes', d.outcomes,
    'rules', d.rules,
    'source', jsonb_strip_nulls(jsonb_build_object('name', d.source_name, 'url', d.source_url)),
    'settlement', d.settlement,
    'opens_at', markets.utc(d.opens_at),
    'closes_at', markets.utc(m.closes_at),
    'state', m.state,
    'result', case m.resolution when 'YES' then 'yes' when 'NO' then 'no' end,
    'cancel_reason', d.cancel_reason,
    'settled_at', markets.utc(m.settled_at),
    'created_at', markets.utc(m.created_at),
    'updated_at', markets.utc(m.updated_at)
  ))
  from markets.details d
  join markets.markets m on m.id = d.market_id
  where d.market_id = market_record.market_id
    and m.resolution is distinct from 'MKT';
$$;


-- 4. The market log ---------------------------------------------------------------------------------

create table markets.log (
  id bigint generated always as identity primary key,
  market_id uuid not null references markets.markets (id),
  action text not null
    constraint log_action_values check (action in ('create', 'open', 'close', 'settle')),
  by_account uuid not null,
  at timestamptz not null default clock_timestamp(),
  outcome text
    constraint log_outcome_values check (outcome in ('yes', 'no', 'probability', 'cancel')),
  probability numeric(10, 8)
    constraint log_probability_range check (probability between 0.01 and 0.99),
  evidence agreement.plain_text
    constraint log_evidence_length check (char_length(evidence) <= 2000),
  reason agreement.one_line
    constraint log_reason_length check (char_length(reason) <= 200),
  paid_to_people numeric(20, 6),
  people integer,
  to_house numeric(20, 6),
  constraint log_settlement check (
    case when action = 'settle' then
      outcome is not null and evidence is not null
      and (outcome = 'probability') = (probability is not null)
      and (outcome = 'cancel') = (reason is not null)
      and paid_to_people is not null and people is not null and to_house is not null
    else
      outcome is null and probability is null and evidence is null and reason is null
      and paid_to_people is null and people is null and to_house is null
    end
  )
);
comment on table markets.log is
  'Every create, open, close and settlement of a market: who did it (an admin''s account) and '
  'when; for a settlement, the outcome (yes, no, a set probability, or cancel), the evidence, the '
  'reason for a cancel, and what it paid: to people (net, after a cancel takes back sale profits), '
  'to how many, and to the house. Lines are never edited or deleted. Who is the admin''s account '
  'ID, kept as a record with no foreign key, so removing an account one day never needs a log '
  'line changed; only an admin, checked against the admins table, can add one.';
create index log_by_market on markets.log (market_id, id);

create function markets.refuse_log_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'The market log is never edited or deleted'
    using errcode = 'restrict_violation',
          hint = 'Every create, open, close and settlement adds a line of its own.';
end;
$$;

create trigger log_never_changes
  before update or delete on markets.log
  for each row execute function markets.refuse_log_change();
create trigger log_never_truncated
  before truncate on markets.log
  for each statement execute function markets.refuse_log_change();


-- 5. The console's calls -----------------------------------------------------------------------------

-- A market as the console shows it: the agreement's fields, its trading state and money, and,
-- with `with_log`, its log, newest last.
create function markets.console_view(market_id uuid, with_log boolean)
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

create schema admin;
comment on schema admin is
  'What admins do (PLAN.md step 1.7c): the market console''s calls. Each checks that the signed-in '
  'account is in the admins table before anything else, so the database itself refuses everyone '
  'else. The app''s own role may call them.';
revoke all on schema admin from public;

-- Whether the signed-in account is an admin: what the console asks before it shows anything.
create function admin.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin(auth.uid());
$$;

-- Markets newest first (their IDs are version 7 UUIDs, which sort by when they were made), up to
-- `max_count` at a time; `after_market` is the last market of the page before. Answers
-- {"markets": [...], "next": the ID to ask after for the next page, or null}.
create function admin.markets(after_market uuid, max_count integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  who uuid := private.signed_in_admin();
  ids uuid[];
begin
  if max_count is null or max_count not between 1 and 100 then
    raise exception 'A page holds 1 to 100 markets' using errcode = 'invalid_parameter_value';
  end if;
  select coalesce(array_agg(x.market_id order by x.market_id desc), '{}') into ids
  from (
    select d.market_id
    from markets.details d
    where after_market is null or d.market_id < after_market
    order by d.market_id desc
    limit max_count + 1
  ) x;
  return jsonb_build_object(
    'markets', coalesce((
      select jsonb_agg(markets.console_view(i.id, false) order by i.n)
      from unnest(ids[1:max_count]) with ordinality as i (id, n)
    ), '[]'::jsonb),
    'next', case when cardinality(ids) > max_count then ids[max_count] end
  );
end;
$$;

-- One market, with its log.
create function admin.market(market uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  who uuid := private.signed_in_admin();
  found_market jsonb := markets.console_view(market, true);
begin
  if found_market is null then
    raise exception 'No such market' using errcode = 'no_data_found';
  end if;
  return found_market;
end;
$$;

-- Creates a yes-or-no market as a draft, holding no money until it opens. The caller chooses its
-- ID (a version 7 UUID, as the agreement's records have), so a retried request gets back the
-- market its first try made and never makes a second; the same ID for a different question is
-- refused. The house's seed and the starting probability are set now and used when it opens.
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
  seed numeric
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

  -- One market per ID, even when a retry arrives while the first try is still running.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin.create_market:' || create_market.market::text, 0));
  select * into existing from markets.details d where d.market_id = create_market.market;
  if found then
    if existing.created_by = who and existing.question = create_market.question then
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
                               source_url, settlement, opens_at, created_by)
  values (create_market.market, create_market.question,
          create_market.categories::agreement.category[], 'yes_no', create_market.rules,
          create_market.source_name, create_market.source_url, 'by_hand', create_market.opens_at,
          who);
  insert into markets.log (market_id, action, by_account, at)
  values (create_market.market, 'create', who, made_at);
  return markets.console_view(create_market.market, true);
end;
$$;

-- Opens a draft: betting starts at once (its opening time becomes this moment), and the house
-- seeds its pool with the seed set when it was made, at its starting probability.
create function admin.open_market(market uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid := private.signed_in_admin();
  opened timestamptz := date_trunc('milliseconds', clock_timestamp());
  m markets.markets;
  d markets.details;
  house uuid;
begin
  select * into m from markets.markets x where x.id = open_market.market for update;
  select * into d from markets.details x where x.market_id = open_market.market;
  if m.id is null or d.market_id is null then
    raise exception 'No such market' using errcode = 'no_data_found';
  end if;
  if m.state <> 'draft' then
    raise exception 'Only a draft opens: this market is %', m.state
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  if d.kind <> 'yes_no' then
    raise exception 'Only a yes-or-no market can open for now'
      using errcode = 'feature_not_supported';
  end if;
  if m.closes_at <= opened then
    raise exception 'Its closing time has passed: make a new market instead'
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  house := ledger.house();
  -- The market's new state first: a seed fits only an open market (ledger.post_moves).
  update markets.markets x
  set state = 'open', pool_yes = m.seed, pool_no = m.seed, updated_at = opened
  where x.id = m.id;
  update markets.details x set opens_at = opened where x.market_id = m.id;
  perform ledger.lock(array[house, m.account_id]);
  perform ledger.post('seed', m.id, null,
    jsonb_build_array(jsonb_build_object('from', house, 'to', m.account_id, 'amount', m.seed)));
  insert into markets.log (market_id, action, by_account, at) values (m.id, 'open', who, opened);
  return markets.console_view(m.id, true);
end;
$$;

-- Closes an open market: betting stops at once (its closing time becomes this moment, if that's
-- earlier). Resting orders stay until it's settled, which cancels them.
create function admin.close_market(market uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid := private.signed_in_admin();
  closed timestamptz := date_trunc('milliseconds', clock_timestamp());
  m markets.markets;
begin
  select * into m from markets.markets x where x.id = close_market.market for update;
  if m.id is null or not exists (select 1 from markets.details x where x.market_id = m.id) then
    raise exception 'No such market' using errcode = 'no_data_found';
  end if;
  if m.state <> 'open' then
    raise exception 'Only an open market closes: this market is %', m.state
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  update markets.markets x
  set state = 'closed', closes_at = least(x.closes_at, closed), updated_at = closed
  where x.id = m.id;
  insert into markets.log (market_id, action, by_account, at) values (m.id, 'close', who, closed);
  return markets.console_view(m.id, true);
end;
$$;

-- Settles a closed market by hand, in one transaction with the ledger's settlement
-- (markets.settle): yes or no pays Ṁ1 a winning share; a set probability pays each Yes share
-- that much and each No share the rest; a cancel, only when the market can't be settled fairly,
-- gives each person back what they put in, less what they took out. The house gets what's left,
-- so the market ends holding nothing. Every settlement gives its evidence, and a cancel its
-- reason; the log keeps both, with what it paid.
create function admin.settle_market(
  market uuid,
  outcome text,
  probability numeric,
  evidence text,
  reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid := private.signed_in_admin();
  m markets.markets;
  resolution text;
  settled jsonb;
begin
  if settle_market.outcome is null
     or settle_market.outcome not in ('yes', 'no', 'probability', 'cancel') then
    raise exception 'A market settles yes, no or at a set probability, or is cancelled'
      using errcode = 'invalid_parameter_value';
  end if;
  if (settle_market.outcome = 'probability') <> (settle_market.probability is not null) then
    raise exception 'A set probability, and only a set probability, gives a probability'
      using errcode = 'invalid_parameter_value';
  end if;
  if settle_market.probability < 0.01 or settle_market.probability > 0.99
     or settle_market.probability <> round(settle_market.probability, 8) then
    raise exception 'A set probability is between 1%% and 99%%, to at most 8 decimal places'
      using errcode = 'invalid_parameter_value';
  end if;
  if (settle_market.outcome = 'cancel') <> (settle_market.reason is not null) then
    raise exception 'A cancel, and only a cancel, gives its reason'
      using errcode = 'invalid_parameter_value';
  end if;
  if settle_market.evidence is null then
    raise exception 'Every settlement gives its evidence' using errcode = 'invalid_parameter_value';
  end if;

  select * into m from markets.markets x where x.id = settle_market.market for update;
  if m.id is null or not exists (select 1 from markets.details x where x.market_id = m.id) then
    raise exception 'No such market' using errcode = 'no_data_found';
  end if;
  if m.state <> 'closed' then
    raise exception 'Only a closed market is settled: this market is %', m.state
      using errcode = 'object_not_in_prerequisite_state';
  end if;

  resolution := case settle_market.outcome
    when 'yes' then 'YES' when 'no' then 'NO' when 'probability' then 'MKT' else 'CANCEL' end;
  settled := markets.settle(m.id, resolution, settle_market.probability);
  if settle_market.outcome = 'cancel' then
    update markets.details x set cancel_reason = settle_market.reason where x.market_id = m.id;
  end if;
  insert into markets.log (market_id, action, by_account, at, outcome, probability, evidence,
                           reason, paid_to_people, people, to_house)
  values (m.id, 'settle', who, (settled ->> 'at')::timestamptz, settle_market.outcome,
          settle_market.probability, settle_market.evidence, settle_market.reason,
          (settled ->> 'paid_to_people')::numeric, (settled ->> 'people')::integer,
          (settled ->> 'to_house')::numeric);
  return markets.console_view(m.id, true);
end;
$$;


-- Who may call what --------------------------------------------------------------------------------
-- The app's own role may call the console's calls, each checking the admins table itself, and
-- nothing else new. The helpers and rules above stay with the owner.

revoke all on function markets.is_outcome_list(jsonb) from public;
revoke all on function markets.check_details() from public;
revoke all on function markets.utc(timestamptz) from public;
revoke all on function markets.market_record(uuid) from public;
revoke all on function markets.refuse_log_change() from public;
revoke all on function markets.console_view(uuid, boolean) from public;
revoke all on all functions in schema admin from public, anon, authenticated, service_role;

grant usage on schema admin to hrizzup_app;
grant execute on function admin.is_admin() to hrizzup_app;
grant execute on function admin.markets(uuid, integer) to hrizzup_app;
grant execute on function admin.market(uuid) to hrizzup_app;
grant execute on function
  admin.create_market(uuid, text, text[], text, text, text, timestamptz, timestamptz, numeric, numeric)
  to hrizzup_app;
grant execute on function admin.open_market(uuid) to hrizzup_app;
grant execute on function admin.close_market(uuid) to hrizzup_app;
grant execute on function admin.settle_market(uuid, text, numeric, text, text) to hrizzup_app;
