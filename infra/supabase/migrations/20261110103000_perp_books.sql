-- The perp's books (PLAN.md step 3.4a; section 2, "Perps"; the founder's decisions of 8 and 10
-- November 2026). Round 4, relay R5. Database changes land first: nothing calls these yet. The
-- typed API's calls and the console follow in the next pull requests, and the scheduled jobs
-- (every 5 seconds the next stand-in price and the liquidation check, every hour the funding) in a
-- later migration, once the code they call is on staging.
--
-- What this adds:
--   1. The books learn the perp (schema ledger). Each perp's two pools, long and short, are
--      accounts of their own, never below zero, and five new kinds of entry move play money for
--      it: the house's seed into the pools; a trade (the margin and the opening fee into the
--      trader's own side, a close's payout out of the pools); a new price (winners settled when the
--      pools run short, and the pools' own balancing); the hourly funding (the crowded side's pool
--      paying the other's); and a test perp's retirement (what its pools hold, back to the house).
--      Every move is still one row out of one account into another, in exact decimals, so the
--      books still sum to zero, and ledger.problems() learns the perp's rules too.
--   2. The perp as data (schema perps): the real Bitcoin perp, made here, listed and switched off
--      (halted), with Manifold's defaults and the 10-times cap (the founder's decision, 10
--      November 2026), on the stand-in price; and room for each check run's own unlisted test
--      perps, which an admin makes with their own seed and retires once the run is done.
--   3. Its settings (Manifold's PerpSettings, a column each, inside Manifold's own bounds and the
--      10-times cap); its positions (each person's one open position, long or short, keeping the
--      maths' own figures exactly as it computed them); every event on a position; every price
--      applied; every funding; every trade request with its first answer, so a retry never trades
--      twice; and the rule-change log: every change to its rules, with when, who and why, from the
--      first day.
--   4. Its off switch: Manifold's trading modes, on (enabled), closing only (reduce-only) and
--      halted. Halted stops everything: no trade, no new price, no liquidation and no funding.
--   5. The steps. perps.begin_step takes the perp's lock (every trade, price and funding on one
--      perp runs strictly one after another), answers a retried request with its first answer,
--      locks every account the step can pay, and hands the server the book with the database's
--      own time; the server runs the perp's maths (@hrizzup/market-engine) and rounds its results
--      once; perps.apply_step writes the moves, positions, events, price and funding together, or
--      nothing, after checking them (below).
--   6. The console's calls (schema admin), admins only, every change logged: the perps, one perp
--      with its log, the off switch, the settings, and a check run's test perps (make, retire).
--   7. The reads: a perp's public details, the signed-in person's positions, and which perps the
--      scheduled jobs have work on.
--
-- The maths runs once, in TypeScript, never a second copy in SQL. What the database checks is the
-- money and the rules around it: every move fits its entry; no pool and no person goes below
-- zero; an open puts in exactly the margin asked, a fee of at most what the trader accepts and
-- less than half the margin, at no more than the leverage allowed; payouts go only to the perp's
-- own traders, a close's at most what the position is worth at the price and a settlement's at
-- most its margin; a liquidation only where the price reached the position's liquidation price,
-- and none left undone; each price once, at its own 5-second step, never older than the last; an
-- order filled only at a price published after it was placed, and never at a stale one; funding
-- at most once a period, inside its cap; and the off switch, whatever the server sends.


-- 1. The books learn the perp ----------------------------------------------------------------------

alter table ledger.accounts drop constraint accounts_kind;
alter table ledger.accounts add constraint accounts_kind
  check (kind in ('house', 'person', 'market', 'perp_pool'));
alter table ledger.accounts add constraint accounts_perp_pool_never_below_zero
  check (kind <> 'perp_pool' or balance >= 0);
comment on table ledger.accounts is
  'Every account of play money: the house (one; it gives out starting balances and seeds new '
  'markets and perps, so its balance is minus everything given out), each person (by their '
  'sign-in account), each market''s pool, and each perp''s two pools (long and short). The '
  'balance always equals the account''s lines.';

alter table ledger.entries add column perp_id uuid;
comment on column ledger.entries.perp_id is
  'The perp a perp entry (kinds perp_seed, perp_trade, perp_price, perp_funding, perp_retire) '
  'belongs to; null for every other entry.';
alter table ledger.entries drop constraint entries_kind;
alter table ledger.entries add constraint entries_kind check (
  kind in ('grant', 'seed', 'trade', 'settle', 'cancel', 'correction',
           'perp_seed', 'perp_trade', 'perp_price', 'perp_funding', 'perp_retire')
);
alter table ledger.entries add constraint entries_perp check (
  (kind in ('perp_seed', 'perp_trade', 'perp_price', 'perp_funding', 'perp_retire'))
  = (perp_id is not null)
);
create index entries_perp on ledger.entries (perp_id) where perp_id is not null;

-- A move is a finite amount: numeric also holds NaN, which compares above every number, so
-- "more than zero" alone would let one through.
alter table ledger.moves add constraint moves_finite check (amount < 'Infinity');


-- 2. The perp as data --------------------------------------------------------------------------------

create schema perps;
comment on schema perps is
  'The Bitcoin perp, in play money (PLAN.md step 3.4a): each perp, its settings and off switch, '
  'positions, events, prices, fundings, trade requests and rule-change log. Reached only through '
  'its functions.';
revoke all on schema perps from public;

create table perps.perps (
  id agreement.record_id primary key,
  long_account_id uuid not null unique references ledger.accounts (id),
  short_account_id uuid not null unique references ledger.accounts (id),
  name agreement.one_line not null
    constraint perps_name_length check (char_length(name) between 1 and 120),
  listed boolean not null,
  state text not null default 'live',
  trading_mode text not null default 'halted',
  -- Where its price comes from: the stand-in (PLAN.md step 3.4a) until the real one (3.4b).
  feed text not null,
  stand_in_seed text,
  stand_in_origin timestamptz not null,
  stand_in_start_price numeric not null,
  stand_in_volatility numeric not null,
  -- Its settings: Manifold's PerpSettings (product/packages/market-engine/src/perp/settings.ts).
  max_leverage numeric not null,
  taker_fee_bps numeric not null,
  taker_fee_impact numeric not null,
  funding_period_ms bigint not null,
  funding_sensitivity numeric not null,
  max_funding_rate numeric not null,
  max_price_age_ms bigint not null,
  subsidy_long numeric(20, 6) not null,
  subsidy_short numeric(20, 6) not null,
  -- Its book: the last price applied (none until the first), and when funding last ran.
  price numeric,
  price_at timestamptz,
  funding_from timestamptz not null,
  last_funding_at timestamptz,
  paused_reason text,
  steps bigint not null default 0,
  created_by uuid,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  retired_at timestamptz,
  constraint perps_two_pools check (long_account_id <> short_account_id),
  constraint perps_state check (state in ('live', 'retired')),
  constraint perps_trading_mode check (trading_mode in ('enabled', 'reduce-only', 'halted')),
  constraint perps_retired check (
    case when state = 'retired' then trading_mode = 'halted' and retired_at is not null
         else retired_at is null end
  ),
  constraint perps_feed check (feed = 'stand-in-btc-usd'),
  constraint perps_seed check (
    case when listed then stand_in_seed is null else stand_in_seed ~ '^[0-9a-f]{16}$' end
  ),
  constraint perps_stand_in check (
    stand_in_start_price > 0 and stand_in_start_price < 'Infinity'
    and stand_in_volatility > 0 and stand_in_volatility <= 100
  ),
  constraint perps_max_leverage check (max_leverage >= 1 and max_leverage <= 10),
  constraint perps_taker_fee check (
    taker_fee_bps >= 0 and taker_fee_bps <= 100 and taker_fee_impact >= 0 and taker_fee_impact <= 100
  ),
  constraint perps_funding check (
    funding_period_ms >= 3600000 and funding_sensitivity > 0 and funding_sensitivity < 'Infinity'
    and max_funding_rate > 0 and max_funding_rate < 1
  ),
  constraint perps_price_age check (max_price_age_ms > 0),
  constraint perps_subsidy check (
    subsidy_long > 0 and subsidy_short > 0
    and subsidy_long < 'Infinity' and subsidy_short < 'Infinity'
  ),
  constraint perps_price check (
    (price is null) = (price_at is null) and (price is null or (price > 0 and price < 'Infinity'))
  ),
  constraint perps_paused check (paused_reason is null or char_length(paused_reason) between 1 and 1000),
  constraint perps_steps check (steps >= 0)
);
comment on table perps.perps is
  'Each perp: the real Bitcoin perp (listed; made by the migration that made this table) and each '
  'check run''s own test perps (unlisted, made by an admin with their own seed, retired once the run '
  'is done). Its money sits in its two pool accounts; its settings are Manifold''s PerpSettings, a '
  'column each; its book is the last price applied and when funding last ran. Every change to its '
  'rules goes into perps.rule_changes.';
comment on column perps.perps.trading_mode is
  'The off switch, Manifold''s trading modes: enabled (on), reduce-only (closing only: no opens) '
  'and halted (off: no trade, no new price, no liquidation and no funding). A perp starts halted.';
comment on column perps.perps.stand_in_seed is
  'A test perp''s own seed for its stand-in price (16 hexadecimal digits), which its check run '
  'knows. Null for the listed perp, whose seed is the environment''s own secret (Doppler, '
  'PERP_STAND_IN_SEED): the repository is public, and a known seed would show every future price.';
comment on column perps.perps.stand_in_volatility is
  'How much the stand-in price moves in a year (0.55: Bitcoin''s 55%). A test perp''s may be far '
  'higher, so a check run can see a liquidation within a minute.';
comment on column perps.perps.funding_from is
  'When the first funding period starts (Manifold''s market creation): when the perp was made, '
  'unless a test perp starts it earlier so a check run needn''t wait an hour for its funding.';
comment on column perps.perps.paused_reason is
  'Why trading is paused, when a new price couldn''t be applied without leaving the pools short '
  '(Manifold''s solvency halt): the price moves on, the pools and positions don''t, and trading '
  'stays paused until a later price applies cleanly. Not the off switch.';
comment on column perps.perps.steps is
  'How many steps (trades, prices, fundings) the perp has run, one after another under its lock.';
comment on column perps.perps.created_by is
  'The admin who made a test perp (their account''s ID, kept as a record with no foreign key); '
  'null for the listed perp, which a migration made.';

create table perps.positions (
  id uuid primary key,
  perp_id uuid not null references perps.perps (id),
  account_id uuid not null references ledger.accounts (id),
  direction text not null,
  size numeric not null,
  cost_basis numeric not null,
  original_cost_basis numeric not null,
  taker_fee_cost_basis numeric not null,
  entry_price numeric not null,
  leverage numeric not null,
  liquidation_price numeric not null,
  opened_at timestamptz not null,
  updated_at timestamptz not null,
  closed_at timestamptz,
  close_reason text,
  constraint positions_direction check (direction in ('long', 'short')),
  -- Finite numbers (numeric also holds NaN and infinity, which compare above every number). A
  -- long's liquidation price falls below zero once winners scaled down leave it under 1 times
  -- leverage: the price can never reach it.
  constraint positions_numbers check (
    size >= 0 and cost_basis >= 0 and original_cost_basis >= 0 and taker_fee_cost_basis >= 0
    and entry_price > 0 and leverage >= 0
    and size < 'Infinity' and cost_basis < 'Infinity' and original_cost_basis < 'Infinity'
    and taker_fee_cost_basis < 'Infinity' and entry_price < 'Infinity' and leverage < 'Infinity'
    and liquidation_price > '-Infinity' and liquidation_price < 'Infinity'
  ),
  constraint positions_open_or_closed check (
    case when closed_at is null then size > 0 and cost_basis > 0 and leverage > 0 and close_reason is null
         else close_reason in ('closed', 'flipped', 'liquidated', 'settled') end
  )
);
comment on table perps.positions is
  'Each person''s positions in each perp: at most one open at a time (long or short, Manifold''s '
  'one-way mode), and every closed one, as it stood when it closed. Its figures are the maths'' own '
  '(Manifold''s PerpPosition: size is the notional, cost basis the margin as funding has scaled '
  'it), kept exactly as computed so the maths continues from precisely where it left off; the '
  'play money itself is in the perp''s pools and the books.';
comment on column perps.positions.close_reason is
  'How it closed: closed by its owner, flipped (closed by an open on the other side), liquidated '
  '(the price reached its liquidation price; its margin stayed in the pool) or settled (scaled '
  'down to nothing when the pools ran short, its margin paid back).';
create unique index positions_one_open_each on perps.positions (perp_id, account_id)
  where closed_at is null;
create index positions_open_by_account on perps.positions (account_id) where closed_at is null;

create table perps.events (
  id bigint generated always as identity primary key,
  perp_id uuid not null references perps.perps (id),
  step bigint not null,
  phase text not null,
  kind text not null,
  position_id uuid not null references perps.positions (id),
  account_id uuid not null references ledger.accounts (id),
  at timestamptz not null,
  price numeric not null,
  size_change numeric not null,
  cost_basis_change numeric not null,
  margin numeric(20, 6) not null default 0,
  fee numeric(20, 6) not null default 0,
  payout numeric(20, 6) not null default 0,
  request_id uuid,
  constraint events_phase check (phase in ('price', 'funding', 'trade')),
  constraint events_kind check (
    case phase
      when 'price' then kind in ('liquidation', 'adl', 'settle')
      when 'funding' then kind in ('funding', 'adl', 'settle')
      else kind in ('open', 'add', 'close')
    end
  ),
  constraint events_finite check (
    size_change > '-Infinity' and size_change < 'Infinity'
    and cost_basis_change > '-Infinity' and cost_basis_change < 'Infinity'
    and margin < 'Infinity' and fee < 'Infinity' and payout < 'Infinity' and price < 'Infinity'
  ),
  constraint events_money check (
    margin >= 0 and fee >= 0 and payout >= 0
    and (kind in ('open', 'add') or (margin = 0 and fee = 0))
    and (kind in ('close', 'settle') or payout = 0)
  ),
  constraint events_price check (price > 0)
);
comment on table perps.events is
  'Every change to a position, in the order the perp''s steps made them: opened, added to, '
  'closed (all or part, or flipped), liquidated, scaled down when the pools ran short (adl), '
  'settled, or scaled by funding; with the play money it moved (margin and fee in, payout out). '
  'Never edited or deleted.';
create index events_by_perp on perps.events (perp_id, step);
create index events_by_position on perps.events (position_id);

create table perps.prices (
  perp_id uuid not null references perps.perps (id),
  at timestamptz not null,
  price numeric not null,
  step bigint not null,
  applied_at timestamptz not null,
  liquidations integer not null default 0,
  primary key (perp_id, at),
  constraint prices_price check (price > 0 and price < 'Infinity'),
  constraint prices_liquidations check (liquidations >= 0)
);
comment on table perps.prices is
  'Every price applied to a perp''s book, by its own time (the start of its 5-second step): once '
  'each, never older than the last, with the step that applied it (a scheduled check or a trade) '
  'and how many positions it liquidated. Never edited or deleted.';

create table perps.fundings (
  id bigint generated always as identity primary key,
  perp_id uuid not null references perps.perps (id),
  step bigint not null,
  at timestamptz not null,
  rate numeric not null,
  price numeric not null,
  open_interest_long numeric not null,
  open_interest_short numeric not null,
  pool_long_before numeric(20, 6) not null,
  pool_short_before numeric(20, 6) not null,
  pool_long_after numeric(20, 6) not null,
  pool_short_after numeric(20, 6) not null,
  unique (perp_id, at),
  constraint fundings_price check (price > 0 and price < 'Infinity'),
  constraint fundings_finite check (
    rate > -1 and rate < 1 and open_interest_long >= 0 and open_interest_short >= 0
    and open_interest_long < 'Infinity' and open_interest_short < 'Infinity'
    and pool_long_before < 'Infinity' and pool_short_before < 'Infinity'
    and pool_long_after < 'Infinity' and pool_short_after < 'Infinity'
  )
);
comment on table perps.fundings is
  'Every funding (once a period): the rate (above zero, longs paid shorts; below zero, shorts paid '
  'longs), the open interest it came from, and the pools before and after. Never edited or '
  'deleted.';

create table perps.requests (
  account_id uuid not null references ledger.accounts (id),
  id uuid not null,
  perp_id uuid not null references perps.perps (id),
  action text not null,
  params jsonb not null,
  placed_at timestamptz not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (account_id, id),
  constraint requests_action check (action in ('open', 'close'))
);
comment on table perps.requests is
  'Each perp trade request, by the ID its sender chose, with when it was placed and its first '
  'answer: a retry returns that answer and never trades twice. A refusal is an answer too. Never '
  'edited or deleted.';

create table perps.rule_changes (
  id bigint generated always as identity primary key,
  perp_id uuid not null references perps.perps (id),
  at timestamptz not null default clock_timestamp(),
  by_account uuid,
  rule text not null,
  old_value text,
  new_value text not null,
  reason agreement.one_line not null
    constraint rule_changes_reason_length check (char_length(reason) between 1 and 300),
  constraint rule_changes_rule check (
    rule in ('created', 'stand_in', 'trading_mode', 'max_leverage', 'taker_fee_bps',
             'taker_fee_impact', 'funding_period_ms', 'funding_sensitivity', 'max_funding_rate',
             'max_price_age_ms', 'subsidy_long', 'subsidy_short', 'funding_from', 'retired')
  ),
  constraint rule_changes_value_length check (
    char_length(new_value) <= 300 and (old_value is null or char_length(old_value) <= 300)
  )
);
comment on table perps.rule_changes is
  'The rule-change log (PLAN.md section 2, "A rule-change log from the first day"): every change to '
  'a perp''s rules (its settings and its off switch), with when, who (an admin''s account ID, kept '
  'as a record with no foreign key; null when a migration made it) and why, the old value and the '
  'new. A perp''s first rules are its first lines. Never edited or deleted.';
create index rule_changes_by_perp on perps.rule_changes (perp_id, id);

alter table ledger.entries
  add constraint entries_perp_fk foreign key (perp_id) references perps.perps (id);

-- What is only ever added to is never edited, deleted or emptied.
create trigger events_never_change
  before update or delete on perps.events
  for each row execute function ledger.refuse_change();
create trigger events_never_truncated
  before truncate on perps.events
  for each statement execute function ledger.refuse_change();
create trigger prices_never_change
  before update or delete on perps.prices
  for each row execute function ledger.refuse_change();
create trigger prices_never_truncated
  before truncate on perps.prices
  for each statement execute function ledger.refuse_change();
create trigger fundings_never_change
  before update or delete on perps.fundings
  for each row execute function ledger.refuse_change();
create trigger fundings_never_truncated
  before truncate on perps.fundings
  for each statement execute function ledger.refuse_change();
create trigger requests_never_change
  before update or delete on perps.requests
  for each row execute function ledger.refuse_change();
create trigger requests_never_truncated
  before truncate on perps.requests
  for each statement execute function ledger.refuse_change();
create trigger rule_changes_never_change
  before update or delete on perps.rule_changes
  for each row execute function ledger.refuse_change();
create trigger rule_changes_never_truncated
  before truncate on perps.rule_changes
  for each statement execute function ledger.refuse_change();
-- Perps and positions change as trading goes on, but are never deleted or emptied.
create function perps.refuse_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Perps and their positions are never deleted (%)', tg_table_name
    using errcode = 'restrict_violation',
          hint = 'A test perp is retired (admin.retire_test_perp); a position is closed.';
end;
$$;
create trigger perps_never_deleted
  before delete on perps.perps
  for each row execute function perps.refuse_delete();
create trigger perps_never_truncated
  before truncate on perps.perps
  for each statement execute function ledger.refuse_change();
create trigger positions_never_deleted
  before delete on perps.positions
  for each row execute function perps.refuse_delete();
create trigger positions_never_truncated
  before truncate on perps.positions
  for each statement execute function ledger.refuse_change();

-- What never changes once a perp is made: who it is, its pools, whether it's listed, its seed and
-- its stand-in price's walk.
create function perps.guard_perp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id or new.long_account_id <> old.long_account_id
     or new.short_account_id <> old.short_account_id or new.listed <> old.listed
     or new.feed <> old.feed or new.stand_in_seed is distinct from old.stand_in_seed
     or new.stand_in_origin <> old.stand_in_origin
     or new.stand_in_start_price <> old.stand_in_start_price
     or new.stand_in_volatility <> old.stand_in_volatility
     or new.subsidy_long <> old.subsidy_long or new.subsidy_short <> old.subsidy_short
     or new.created_at <> old.created_at or new.created_by is distinct from old.created_by
     or new.funding_from <> old.funding_from then
    raise exception 'A perp''s identity, pools, listing, price walk and seed never change'
      using errcode = 'restrict_violation';
  end if;
  if old.state = 'retired' then
    raise exception 'Perp % is retired', old.id using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
create trigger perps_guard
  before update on perps.perps
  for each row execute function perps.guard_perp();

-- A position keeps its perp, owner and side, and once closed it stays as it closed.
create function perps.guard_position()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id or new.perp_id <> old.perp_id or new.account_id <> old.account_id
     or new.direction <> old.direction or new.opened_at <> old.opened_at then
    raise exception 'A position keeps its perp, owner, side and opening'
      using errcode = 'restrict_violation';
  end if;
  if old.closed_at is not null then
    raise exception 'A closed position stays as it closed' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
create trigger positions_guard
  before update on perps.positions
  for each row execute function perps.guard_position();


-- 3. Posting the perp's moves ----------------------------------------------------------------------

-- Everything it checked before, unchanged, and the perp's five kinds of entry: a perp's moves go
-- only between its own two pools, its traders and (seeding it, or retiring a test perp) the house.
create or replace function ledger.post_moves()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  bad record;
begin
  select m.id, e.kind into bad
  from inserted m
  join ledger.entries e on e.id = m.entry_id
  join ledger.accounts f on f.id = m.from_account
  join ledger.accounts t on t.id = m.to_account
  left join markets.markets mk on mk.id = e.market_id
  left join perps.perps pp on pp.id = e.perp_id
  where not coalesce(
    case e.kind
      when 'grant' then f.kind = 'house' and t.kind = 'person'
      when 'seed' then f.kind = 'house' and t.id = mk.account_id and mk.state = 'open'
      when 'trade' then
        mk.state = 'open'
        and ((f.id = mk.account_id and t.kind = 'person')
             or (f.kind = 'person' and t.id = mk.account_id))
      when 'settle' then
        mk.state = 'settled'
        and ((f.id = mk.account_id and t.kind in ('person', 'house'))
             or (f.kind = 'house' and t.id = mk.account_id))
      when 'cancel' then
        mk.state = 'cancelled'
        and ((f.id = mk.account_id and t.kind in ('person', 'house'))
             or (f.kind in ('person', 'house') and t.id = mk.account_id))
      when 'correction' then
        (f.kind = 'house' and t.kind = 'person') or (f.kind = 'person' and t.kind = 'house')
      -- The perp (step 3.4a).
      when 'perp_seed' then
        pp.state = 'live' and f.kind = 'house'
        and t.id in (pp.long_account_id, pp.short_account_id)
      when 'perp_trade' then
        pp.state = 'live'
        and ((f.kind = 'person' and t.id in (pp.long_account_id, pp.short_account_id))
             or (f.id in (pp.long_account_id, pp.short_account_id) and t.kind = 'person'))
      when 'perp_price' then
        pp.state = 'live'
        and f.id in (pp.long_account_id, pp.short_account_id)
        and (t.id in (pp.long_account_id, pp.short_account_id) or t.kind = 'person')
      when 'perp_funding' then
        pp.state = 'live'
        and f.id in (pp.long_account_id, pp.short_account_id)
        and (t.id in (pp.long_account_id, pp.short_account_id) or t.kind = 'person')
      when 'perp_retire' then
        pp.state = 'retired' and f.id in (pp.long_account_id, pp.short_account_id)
        and t.kind = 'house'
    end,
    false)
  limit 1;
  if found then
    raise exception 'Move % does not fit its entry (%)', bad.id, bad.kind
      using errcode = 'check_violation';
  end if;

  perform set_config('ledger.posting', 'on', true);
  update ledger.accounts a
  set balance = a.balance + d.delta
  from (
    select account_id, sum(amount) as delta
    from (
      select from_account as account_id, -amount as amount from inserted
      union all
      select to_account, amount from inserted
    ) l
    group by account_id
  ) d
  where a.id = d.account_id;
  perform set_config('ledger.posting', 'off', true);

  select a.id, a.balance into bad
  from ledger.accounts a
  where a.kind = 'person'
    and a.balance < 0
    and a.id in (
      select m.from_account
      from inserted m
      join ledger.entries e on e.id = m.entry_id
      where e.kind <> 'cancel'
    )
  limit 1;
  if found then
    raise exception 'Not enough play money: this would take a balance below zero'
      using errcode = 'check_violation',
            detail = format('Account %s would hold %s', bad.id, bad.balance);
  end if;
  return null;
end;
$$;

-- Adds a perp's entry and all its moves in one statement. moves: [{"from", "to", "amount"}], each
-- amount more than zero, in exact decimal text to the millionth (anything finer is refused, never
-- rounded away). Returns the entry's ID.
create function ledger.post_perp(kind text, perp_id uuid, memo text, moves jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry bigint;
begin
  if exists (
    select 1 from jsonb_array_elements(post_perp.moves) m
    where (m ->> 'amount') is null
       or (m ->> 'amount')::numeric <= 0
       or (m ->> 'amount')::numeric >= 'Infinity'
       or (m ->> 'amount')::numeric <> round((m ->> 'amount')::numeric, 6)
  ) then
    raise exception 'A perp''s move is more than zero, to the millionth'
      using errcode = 'invalid_parameter_value';
  end if;
  insert into ledger.entries (kind, perp_id, memo)
  values (post_perp.kind, post_perp.perp_id, post_perp.memo)
  returning id into entry;
  insert into ledger.moves (entry_id, from_account, to_account, amount)
  select entry, (m ->> 'from')::uuid, (m ->> 'to')::uuid, (m ->> 'amount')::numeric(20, 6)
  from jsonb_array_elements(post_perp.moves) as m;
  return entry;
end;
$$;

-- Everything it found before, unchanged, and the perp's own: a perp pool that isn't exactly one
-- perp's, and a retired test perp that still holds money or an open position.
create or replace function ledger.problems()
returns table (problem text)
language sql
stable
security definer
set search_path = ''
as $$
  select format('The books do not sum to zero: the balances come to %s', total)
  from (select coalesce(sum(balance), 0) as total from ledger.accounts) t
  where total <> 0
  union all
  select format('Account %s holds %s, but its lines come to %s', a.id, a.balance, coalesce(l.total, 0))
  from ledger.accounts a
  left join (select account_id, sum(amount) as total from ledger.lines group by account_id) l
    on l.account_id = a.id
  where a.balance <> coalesce(l.total, 0)
  union all
  select format('Person %s is below zero (%s) with no cancelled market to explain it', a.id, a.balance)
  from ledger.accounts a
  where a.kind = 'person'
    and a.balance < 0
    and not exists (
      select 1
      from ledger.moves m
      join ledger.entries e on e.id = m.entry_id
      where m.from_account = a.id and e.kind = 'cancel'
    )
  union all
  select format('Market %s holds %s, but its Yes shares come to %s and its No shares to %s',
                m.id, a.balance, m.pool_yes + coalesce(p.yes_held, 0), m.pool_no + coalesce(p.no_held, 0))
  from markets.markets m
  join ledger.accounts a on a.id = m.account_id
  left join (
    select market_id, sum(yes_shares) as yes_held, sum(no_shares) as no_held
    from markets.positions group by market_id
  ) p on p.market_id = m.id
  where m.state in ('draft', 'open', 'closed')
    and (a.balance <> m.pool_yes + coalesce(p.yes_held, 0)
         or a.balance <> m.pool_no + coalesce(p.no_held, 0))
  union all
  select format('Market %s is %s but still holds %s', m.id, m.state, a.balance)
  from markets.markets m
  join ledger.accounts a on a.id = m.account_id
  where m.state in ('settled', 'cancelled') and a.balance <> 0
  union all
  select format('Sign-in account %s has no play-money account', u.id)
  from auth.users u
  where not exists (
    select 1 from ledger.accounts a where a.kind = 'person' and a.user_id = u.id
  )
  union all
  select format('Person %s has no starting balance', a.id)
  from ledger.accounts a
  where a.kind = 'person'
    and a.user_id is not null
    and not exists (select 1 from ledger.starting_balances s where s.account_id = a.id)
  union all
  select format('The starting balance of %s is not the entry %s says it is', s.account_id, s.entry_id)
  from ledger.starting_balances s
  join ledger.entries e on e.id = s.entry_id
  where e.kind <> 'grant'
     or e.memo is distinct from 'Starting balance'
     or (select count(*) from ledger.moves m where m.entry_id = s.entry_id) <> 1
     or not exists (
       select 1
       from ledger.moves m
       join ledger.accounts h on h.id = m.from_account and h.kind = 'house'
       where m.entry_id = s.entry_id and m.to_account = s.account_id and m.amount = s.amount
     )
  -- Added with the perp (step 3.4a): each perp pool is exactly one perp's, and a retired test perp
  -- holds nothing and has no open position.
  union all
  select format('Perp pool %s is not one perp''s', a.id)
  from ledger.accounts a
  where a.kind = 'perp_pool'
    and (select count(*) from perps.perps p
         where a.id in (p.long_account_id, p.short_account_id)) <> 1
  union all
  select format('Perp %s is retired but still holds %s', p.id, l.balance + s.balance)
  from perps.perps p
  join ledger.accounts l on l.id = p.long_account_id
  join ledger.accounts s on s.id = p.short_account_id
  where p.state = 'retired' and (l.balance <> 0 or s.balance <> 0)
  union all
  select format('Perp %s is retired but has an open position', p.id)
  from perps.perps p
  where p.state = 'retired'
    and exists (select 1 from perps.positions x where x.perp_id = p.id and x.closed_at is null);
$$;


-- 4. Making a perp, its views and its log ------------------------------------------------------------

-- A perp's settings as the engine reads them (PerpSettings), each as exact text.
create function perps.settings_of(p perps.perps)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'maxLeverage', p.max_leverage::text,
    'takerFeeBps', p.taker_fee_bps::text,
    'takerFeeImpact', p.taker_fee_impact::text,
    'fundingPeriodMs', p.funding_period_ms::text,
    'fundingSensitivity', p.funding_sensitivity::text,
    'maxFundingRate', p.max_funding_rate::text,
    'maxPriceAgeMs', p.max_price_age_ms::text,
    'subsidyLong', p.subsidy_long::text,
    'subsidyShort', p.subsidy_short::text
  );
$$;

-- The settings an admin may change, by the engine's name for each, and the column it is.
create function perps.setting_column(setting text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case setting
    when 'maxLeverage' then 'max_leverage'
    when 'takerFeeBps' then 'taker_fee_bps'
    when 'takerFeeImpact' then 'taker_fee_impact'
    when 'fundingPeriodMs' then 'funding_period_ms'
    when 'fundingSensitivity' then 'funding_sensitivity'
    when 'maxFundingRate' then 'max_funding_rate'
    when 'maxPriceAgeMs' then 'max_price_age_ms'
  end;
$$;

-- A perp as anyone may see it: what it is, its off switch, its settings, its book, its pools and
-- its open interest (the open positions' notional on each side). With `for_admin`, also who made
-- it, its price walk, its steps and when it was retired. Never its seed.
create function perps.view(perp_id uuid, for_admin boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'name', p.name,
    'listed', p.listed,
    'state', p.state,
    'tradingMode', p.trading_mode,
    'feed', p.feed,
    'settings', perps.settings_of(p),
    'price', p.price::text,
    'priceAt', markets.utc(p.price_at),
    'fundingFrom', markets.utc(p.funding_from),
    'lastFundingAt', markets.utc(p.last_funding_at),
    'pausedReason', p.paused_reason,
    'pools', jsonb_build_object('long', l.balance::text, 'short', s.balance::text),
    'openInterest', jsonb_build_object(
      'long', coalesce((select sum(x.size) from perps.positions x
                        where x.perp_id = p.id and x.closed_at is null and x.direction = 'long'), 0)::text,
      'short', coalesce((select sum(x.size) from perps.positions x
                         where x.perp_id = p.id and x.closed_at is null and x.direction = 'short'), 0)::text),
    'openPositions', (select count(*) from perps.positions x
                      where x.perp_id = p.id and x.closed_at is null),
    'createdAt', markets.utc(p.created_at),
    'updatedAt', markets.utc(p.updated_at)
  ) || case when for_admin then jsonb_build_object(
    'createdBy', case when p.created_by is null then null else jsonb_build_object(
      'id', p.created_by,
      'email', (select u.email from auth.users u where u.id = p.created_by)) end,
    'standIn', jsonb_build_object(
      'origin', markets.utc(p.stand_in_origin),
      'startPrice', p.stand_in_start_price::text,
      'volatility', p.stand_in_volatility::text,
      'ownSeed', p.stand_in_seed is not null),
    'steps', p.steps,
    'retiredAt', markets.utc(p.retired_at)
  ) else '{}'::jsonb end
  from perps.perps p
  join ledger.accounts l on l.id = p.long_account_id
  join ledger.accounts s on s.id = p.short_account_id
  where p.id = view.perp_id;
$$;

-- A perp's rule-change log, oldest first.
create function perps.log_of(perp_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'at', markets.utc(r.at),
    'by', case when r.by_account is null then null else jsonb_build_object(
      'id', r.by_account,
      'email', (select u.email from auth.users u where u.id = r.by_account)) end,
    'rule', r.rule,
    'oldValue', r.old_value,
    'newValue', r.new_value,
    'reason', r.reason
  ) order by r.id), '[]'::jsonb)
  from perps.rule_changes r
  where r.perp_id = log_of.perp_id;
$$;

-- Makes a perp, halted: its two pool accounts, seeded by the house with its subsidies (a perp_seed
-- entry), and its first lines in the rule-change log, one for each of its rules. Owner only: this
-- migration makes the listed perp with it, and admin.create_test_perp a check run's own.
create function perps.create_perp(
  perp uuid,
  name text,
  listed boolean,
  seed text,
  origin timestamptz,
  start_price numeric,
  volatility numeric,
  settings jsonb,
  funding_from timestamptz,
  by_account uuid,
  reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  made_at timestamptz := date_trunc('milliseconds', clock_timestamp());
  long_pool uuid;
  short_pool uuid;
  house uuid := ledger.house();
  p perps.perps;
  setting text;
begin
  if settings is null or jsonb_typeof(settings) <> 'object' or exists (
    select 1 from jsonb_object_keys(settings) k
    where k not in ('maxLeverage', 'takerFeeBps', 'takerFeeImpact', 'fundingPeriodMs',
                    'fundingSensitivity', 'maxFundingRate', 'maxPriceAgeMs', 'subsidyLong',
                    'subsidyShort')
  ) or (select count(*) from jsonb_object_keys(settings)) <> 9 then
    raise exception 'A perp is made with all nine of its settings, and nothing else'
      using errcode = 'invalid_parameter_value';
  end if;
  if (settings ->> 'subsidyLong')::numeric >= 'Infinity' or (settings ->> 'subsidyShort')::numeric >= 'Infinity'
     or (settings ->> 'subsidyLong')::numeric <> round((settings ->> 'subsidyLong')::numeric, 6)
     or (settings ->> 'subsidyShort')::numeric <> round((settings ->> 'subsidyShort')::numeric, 6) then
    raise exception 'A perp''s subsidies are play money, to the millionth'
      using errcode = 'invalid_parameter_value';
  end if;
  if create_perp.funding_from is not null and create_perp.funding_from > clock_timestamp() then
    raise exception 'A perp''s first funding period starts no later than it''s made'
      using errcode = 'invalid_parameter_value';
  end if;

  insert into ledger.accounts (kind) values ('perp_pool') returning id into long_pool;
  insert into ledger.accounts (kind) values ('perp_pool') returning id into short_pool;
  insert into perps.perps (
    id, long_account_id, short_account_id, name, listed, state, trading_mode, feed,
    stand_in_seed, stand_in_origin, stand_in_start_price, stand_in_volatility,
    max_leverage, taker_fee_bps, taker_fee_impact, funding_period_ms, funding_sensitivity,
    max_funding_rate, max_price_age_ms, subsidy_long, subsidy_short,
    funding_from, created_by, created_at, updated_at)
  values (
    create_perp.perp, long_pool, short_pool, create_perp.name, create_perp.listed, 'live',
    'halted', 'stand-in-btc-usd', create_perp.seed, create_perp.origin, create_perp.start_price,
    create_perp.volatility,
    (settings ->> 'maxLeverage')::numeric, (settings ->> 'takerFeeBps')::numeric,
    (settings ->> 'takerFeeImpact')::numeric, (settings ->> 'fundingPeriodMs')::bigint,
    (settings ->> 'fundingSensitivity')::numeric, (settings ->> 'maxFundingRate')::numeric,
    (settings ->> 'maxPriceAgeMs')::bigint, (settings ->> 'subsidyLong')::numeric(20, 6),
    (settings ->> 'subsidyShort')::numeric(20, 6),
    coalesce(date_trunc('milliseconds', create_perp.funding_from), made_at), create_perp.by_account,
    made_at, made_at)
  returning * into p;

  perform ledger.lock(array[house, long_pool, short_pool]);
  perform ledger.post_perp('perp_seed', p.id, 'The house''s subsidy for each pool',
    jsonb_build_array(
      jsonb_build_object('from', house, 'to', long_pool, 'amount', p.subsidy_long),
      jsonb_build_object('from', house, 'to', short_pool, 'amount', p.subsidy_short)));

  -- Its first rules, a line each, from the first day.
  insert into perps.rule_changes (perp_id, at, by_account, rule, new_value, reason)
  values (p.id, made_at, create_perp.by_account, 'created', p.name, create_perp.reason),
         (p.id, made_at, create_perp.by_account, 'stand_in',
          format('%s: from %s at %s, volatility %s a year, %s', p.feed, markets.utc(p.stand_in_origin),
                 p.stand_in_start_price, p.stand_in_volatility,
                 case when p.stand_in_seed is null then 'the environment''s own seed'
                      else 'its own seed' end),
          create_perp.reason),
         (p.id, made_at, create_perp.by_account, 'trading_mode', p.trading_mode, create_perp.reason),
         (p.id, made_at, create_perp.by_account, 'funding_from', markets.utc(p.funding_from),
          create_perp.reason);
  foreach setting in array array['maxLeverage', 'takerFeeBps', 'takerFeeImpact', 'fundingPeriodMs',
                                 'fundingSensitivity', 'maxFundingRate', 'maxPriceAgeMs',
                                 'subsidyLong', 'subsidyShort'] loop
    insert into perps.rule_changes (perp_id, at, by_account, rule, new_value, reason)
    values (p.id, made_at, create_perp.by_account,
            coalesce(perps.setting_column(setting),
                     case setting when 'subsidyLong' then 'subsidy_long' else 'subsidy_short' end),
            perps.settings_of(p) ->> setting, create_perp.reason);
  end loop;
end;
$$;


-- 5. The steps: trades, prices and funding ------------------------------------------------------------

-- The refusals a trade can be answered with: the engine's (PerpRefusal in
-- product/packages/market-engine/src/perp/engine.ts).
create function perps.is_refusal(code text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select code in ('trading_off', 'paused', 'stale_price', 'not_next_price', 'bad_request',
                  'leverage_too_high', 'fee_too_high', 'size_fee_unpriceable',
                  'insufficient_balance', 'exposure_cap', 'no_position', 'position_changed',
                  'insolvent');
$$;

-- The start of the moment's 5-second step on a perp's stand-in price: the time its price has.
create function perps.stand_in_step(p perps.perps, moment timestamptz)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select p.stand_in_origin
         + floor(extract(epoch from (moment - p.stand_in_origin)) * 1000 / 5000)
           * interval '5 seconds';
$$;

-- An open position as the engine reads it (PerpPosition), every figure as exact text, with the
-- position's own ID and owner (the owner's play-money account, which the engine calls its user).
create function perps.position_of(x perps.positions)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', x.id,
    'accountId', x.account_id,
    'direction', x.direction,
    'size', x.size::text,
    'costBasis', x.cost_basis::text,
    'originalCostBasis', x.original_cost_basis::text,
    'takerFeeCostBasis', x.taker_fee_cost_basis::text,
    'entryPrice', x.entry_price::text,
    'leverage', x.leverage::text,
    'liquidationPrice', x.liquidation_price::text,
    'openedAt', markets.utc(x.opened_at),
    'updatedAt', markets.utc(x.updated_at),
    'closedAt', markets.utc(x.closed_at),
    'closeReason', x.close_reason
  );
$$;

-- Before a trade, with no lock and nothing written: the perp's off switch and settings, the start of
-- its price's 5-second steps (so the server knows when the next price comes), the signed-in person's
-- balance and open position in it, whether they've already sent `request_id` (the books then answer
-- it), and the database's time, which is when the order is placed. Null for no such perp.
create function perps.holdings(perp uuid, request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  signed_in uuid := auth.uid();
  trader uuid;
  p perps.perps;
begin
  if signed_in is null then
    raise exception 'Trading needs a signed-in account' using errcode = 'insufficient_privilege';
  end if;
  select * into p from perps.perps x where x.id = holdings.perp;
  if not found then
    return null;
  end if;
  select a.id into trader from ledger.accounts a where a.kind = 'person' and a.user_id = signed_in;
  return jsonb_build_object(
    'perpId', p.id,
    'state', p.state,
    'tradingMode', p.trading_mode,
    'settings', perps.settings_of(p),
    'pausedReason', p.paused_reason,
    'priceAt', markets.utc(p.price_at),
    'stepsFrom', markets.utc(p.stand_in_origin),
    'hasAccount', trader is not null,
    'balance', coalesce((select a.balance from ledger.accounts a where a.id = trader), 0)::text,
    'position', (select perps.position_of(x) from perps.positions x
                 where x.perp_id = p.id and x.account_id = trader and x.closed_at is null),
    'answered', trader is not null and exists (
      select 1 from perps.requests r where r.account_id = trader and r.id = holdings.request_id),
    'now', markets.utc(date_trunc('milliseconds', clock_timestamp()))
  );
end;
$$;

-- The start of a step on a perp, inside its transaction: a trade (open or close, by the signed-in
-- account, carrying its request's ID, parameters and when it was placed) or one of the scheduled
-- jobs' (tick: the next price, with its liquidations; funding: the hourly funding), which carry
-- none. Takes the perp's lock, so every step on a perp waits for the one before it (a tick skips a
-- perp that's busy: the step holding it does the same work); answers a request already answered
-- with its first answer; locks every account the step can pay (the trader, the pools, and everyone
-- with an open position), in one fixed order; and hands over what the maths needs, with the
-- database's own time, read once the lock is held and never before the perp's last step: no
-- caller can choose it.
create function perps.begin_step(
  perp uuid,
  action text,
  request_id uuid,
  params jsonb,
  placed_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  signed_in uuid := auth.uid();
  trader uuid;
  p perps.perps;
  answered perps.requests;
  step_at timestamptz;
  owners uuid[];
begin
  if begin_step.action is null or begin_step.action not in ('open', 'close', 'tick', 'funding') then
    raise exception 'Unknown perp step %', begin_step.action using errcode = 'invalid_parameter_value';
  end if;
  if begin_step.action in ('open', 'close') then
    if signed_in is null then
      raise exception 'Trading needs a signed-in account' using errcode = 'insufficient_privilege';
    end if;
    if begin_step.request_id is null or begin_step.params is null or begin_step.placed_at is null
       or jsonb_typeof(begin_step.params) <> 'object' then
      raise exception 'A trade carries its request''s ID, parameters and when it was placed'
        using errcode = 'invalid_parameter_value';
    end if;
  elsif begin_step.request_id is not null or begin_step.params is not null
        or begin_step.placed_at is not null then
    raise exception 'A scheduled step carries no request' using errcode = 'invalid_parameter_value';
  end if;

  if begin_step.action = 'tick' then
    select * into p from perps.perps x where x.id = begin_step.perp for update skip locked;
    if not found then
      if exists (select 1 from perps.perps x where x.id = begin_step.perp) then
        return jsonb_build_object('busy', true);
      end if;
      raise exception 'No such perp' using errcode = 'no_data_found';
    end if;
  else
    select * into p from perps.perps x where x.id = begin_step.perp for update;
    if not found then
      raise exception 'No such perp' using errcode = 'no_data_found';
    end if;
  end if;

  if begin_step.action in ('open', 'close') then
    select a.id into trader from ledger.accounts a where a.kind = 'person' and a.user_id = signed_in;
    if trader is null then
      raise exception 'This account has no play money yet' using errcode = 'no_data_found';
    end if;
    select * into answered
    from perps.requests r
    where r.account_id = trader and r.id = begin_step.request_id;
    if found then
      if answered.perp_id <> p.id or answered.action <> begin_step.action
         or answered.params <> begin_step.params then
        raise exception 'This request ID was already used for a different request'
          using errcode = 'unique_violation';
      end if;
      return jsonb_build_object('replay', answered.result);
    end if;
  end if;

  step_at := date_trunc('milliseconds', greatest(clock_timestamp(), p.updated_at));
  if begin_step.action in ('open', 'close')
     and (begin_step.placed_at > step_at or begin_step.placed_at < step_at - interval '1 minute') then
    raise exception 'An order fills within a minute of being placed, never before'
      using errcode = 'invalid_parameter_value';
  end if;

  -- apply_step checks it follows this, in the same transaction, for this very step: the perp, the
  -- action, the request and its fingerprint, the trader, the time, when it was placed, and how many
  -- steps the perp had run.
  perform set_config('perps.stepping',
    concat_ws('|', p.id, begin_step.action, coalesce(begin_step.request_id::text, '-'),
              coalesce(trader::text, '-'), step_at,
              md5(begin_step.action || ':' || coalesce(begin_step.params::text, '')),
              coalesce(begin_step.placed_at::text, '-'), p.steps),
    true);

  select coalesce(array_agg(distinct x.account_id), '{}') into owners
  from perps.positions x
  where x.perp_id = p.id and x.closed_at is null;
  perform ledger.lock(array_remove(
    owners || array[p.long_account_id, p.short_account_id, trader], null));

  return jsonb_build_object(
    'now', markets.utc(step_at),
    'step', p.steps + 1,
    'perp', jsonb_build_object(
      'id', p.id,
      'state', p.state,
      'tradingMode', p.trading_mode,
      'feed', p.feed,
      'seed', p.stand_in_seed,
      'standIn', jsonb_build_object(
        'origin', markets.utc(p.stand_in_origin),
        'startPrice', p.stand_in_start_price::text,
        'volatility', p.stand_in_volatility::text),
      'settings', perps.settings_of(p),
      'price', p.price::text,
      'priceAt', markets.utc(p.price_at),
      'fundingFrom', markets.utc(p.funding_from),
      'lastFundingAt', markets.utc(p.last_funding_at),
      'pausedReason', p.paused_reason,
      'longAccountId', p.long_account_id,
      'shortAccountId', p.short_account_id),
    'pools', jsonb_build_object(
      'long', (select a.balance from ledger.accounts a where a.id = p.long_account_id)::text,
      'short', (select a.balance from ledger.accounts a where a.id = p.short_account_id)::text),
    'positions', coalesce((
      select jsonb_agg(perps.position_of(x) order by x.opened_at, x.id)
      from perps.positions x
      where x.perp_id = p.id and x.closed_at is null), '[]'::jsonb),
    'trader', case when trader is null then null else jsonb_build_object(
      'accountId', trader,
      'balance', (select a.balance from ledger.accounts a where a.id = trader)::text) end
  );
end;
$$;

-- A figure a step's plan sends: a finite number. Postgres's numeric also holds NaN and infinity,
-- which compare as larger than any number, so they're refused before any rule looks at them.
create function perps.number(figure text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  value numeric := figure::numeric;
begin
  if value is null or value = 'NaN'::numeric
     or value >= 'Infinity'::numeric or value <= '-Infinity'::numeric then
    raise exception 'A step''s figures are finite numbers (got %)', coalesce(figure, 'nothing')
      using errcode = 'invalid_parameter_value';
  end if;
  return value;
end;
$$;

-- Whether two of the maths' figures agree, to floating point's own noise: a billionth of the larger.
create function perps.agree(a numeric, b numeric)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select abs(a - b) <= 1e-9 * greatest(abs(a), abs(b), 1);
$$;

-- The rest of a step, after the server has run the maths on what begin_step handed over: writes the
-- new price, the funding, the trade, every position and event, and every move, together, then
-- stores a trade request's answer. A refused trade stores its refusal, after any new price it
-- applied first (that price's liquidations stand: a scheduled check would have made them).
--
-- plan: {
--   "perp_id", "action", "request_id", "params"   (the step begin_step started),
--   "price": {"at", "price"}                       (a new price, applied first), or absent,
--   "funding": {"rate", "openInterestLong", "openInterestShort"}
--                                                  (the funding ran: action funding), or absent,
--   "refusal": {"code", "message"}                 (the trade was refused), or absent,
--   "paused_reason": why trading is paused after the step, or null,
--   "moves": [{"phase": "price" | "funding" | "trade", "from", "to", "amount"}],
--   "positions": [every position the step changed, as the engine left it (a closed one as it stood
--                 when it closed, with its "closeReason"): {"id", "accountId", "direction", "size",
--                 "costBasis", "originalCostBasis", "takerFeeCostBasis", "entryPrice", "leverage",
--                 "liquidationPrice", "openedAt", "updatedAt", "closeReason"}],
--   "events": [{"phase", "kind", "positionId", "sizeChange", "costBasisChange", "margin", "fee",
--               "payout"}, in the order they happened],
--   "pools": {"long", "short"}                    (what the pools hold afterwards)
-- }
-- Play money is exact decimal text, rounded once on the server; the maths' own figures (sizes,
-- prices, rates) are its numbers written in full, so they read back exactly.
--
-- What it checks, besides what the books check on every move: the step is the one begun; the off
-- switch and the pause; each price once, at this moment's 5-second step; every position as named,
-- a new one only the trader's own open at the book's price; each position's figures exactly what
-- its events make of them (one event a phase, and nothing after it closes), its entry price moving
-- only when it's added to, its leverage and liquidation price following from its figures; a
-- liquidation only where the price reached it, a settlement at most its margin, a close at most what
-- the closed part is worth and its share of the margin; an open's exact margin, at the leverage asked
-- and within the cap, its fee within what was accepted and under half the margin; a fill only at a
-- fresh price published after the order; funding once a period, inside its cap, from the open
-- interest the database itself counts, paid by the crowded side and never more than its rate of the
-- crowded pool, scaling every position it should; payouts only to the perp's own traders, charges
-- only to the trader, pool-to-pool moves only where the maths balances its pools; each person's moves
-- what their events say; the pools what the plan says, to the millionth; and nobody left open past
-- their liquidation price.
create function perps.apply_step(plan jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  marker text[] := string_to_array(current_setting('perps.stepping', true), '|');
  perp uuid := (plan ->> 'perp_id')::uuid;
  step_kind text := plan ->> 'action';
  request uuid := (plan ->> 'request_id')::uuid;
  asking jsonb := nullif(plan -> 'params', 'null'::jsonb);
  refusal jsonb := nullif(plan -> 'refusal', 'null'::jsonb);
  priced jsonb := nullif(plan -> 'price', 'null'::jsonb);
  funded jsonb := nullif(plan -> 'funding', 'null'::jsonb);
  positions_in jsonb := coalesce(nullif(plan -> 'positions', 'null'::jsonb), '[]'::jsonb);
  events_in jsonb := coalesce(nullif(plan -> 'events', 'null'::jsonb), '[]'::jsonb);
  moves_in jsonb := coalesce(nullif(plan -> 'moves', 'null'::jsonb), '[]'::jsonb);
  paused_after text := plan ->> 'paused_reason';
  trader uuid;
  step_at timestamptz;
  placed timestamptz;
  p perps.perps;
  step_no bigint;
  new_price numeric;
  new_price_at timestamptz;
  book_price numeric;
  book_price_at timestamptz;
  rate numeric;
  oi_long numeric;
  oi_short numeric;
  counted_long numeric;
  counted_short numeric;
  crowded_pool uuid;
  other_pool uuid;
  crowded_before numeric;
  other_before numeric;
  transfer numeric := 0;
  owners uuid[];
  pool_long_before numeric;
  pool_short_before numeric;
  pool_long_after numeric;
  pool_short_after numeric;
  item jsonb;
  ev jsonb;
  prior perps.positions;
  size_now numeric;
  margin_now numeric;
  closed_by text;
  added boolean;
  funded_once boolean;
  change_size numeric;
  change_margin numeric;
  factor numeric;
  equity numeric;
  entry numeric;
  added_size numeric;
  closed_direction text;
  closed_margin numeric;
  closed_equity numeric;
  liquidations integer := 0;
  phase_name text;
  result jsonb;
  trader_margin numeric;
  trader_fee numeric;
  trader_payout numeric;
  opened jsonb;
  opening jsonb;
begin
  -- 0. The step begin_step started, in this transaction.
  if marker is null or cardinality(marker) <> 8 or marker[1] <> perp::text or marker[2] <> step_kind
     or marker[3] <> coalesce(request::text, '-') then
    raise exception 'A step is applied only after begin_step, in the same transaction'
      using errcode = 'invalid_transaction_state';
  end if;
  if md5(step_kind || ':' || coalesce(asking::text, '')) is distinct from marker[6] then
    raise exception 'The step''s request is not the one begin_step started'
      using errcode = 'invalid_transaction_state';
  end if;
  trader := nullif(marker[4], '-')::uuid;
  step_at := marker[5]::timestamptz;
  placed := nullif(marker[7], '-')::timestamptz;
  select * into p from perps.perps y where y.id = perp for update;
  if p.steps <> marker[8]::bigint then
    raise exception 'The perp has moved on since begin_step' using errcode = 'invalid_transaction_state';
  end if;
  step_no := p.steps + 1;
  -- Who held an open position as the step began: the only people it may pay.
  select coalesce(array_agg(y.account_id), '{}') into owners
  from perps.positions y where y.perp_id = perp and y.closed_at is null;
  select a.balance into pool_long_before from ledger.accounts a where a.id = p.long_account_id;
  select a.balance into pool_short_before from ledger.accounts a where a.id = p.short_account_id;

  -- Every figure the plan sends is a finite number, and every list is a list.
  if jsonb_typeof(positions_in) <> 'array' or jsonb_typeof(events_in) <> 'array'
     or jsonb_typeof(moves_in) <> 'array' or jsonb_typeof(plan -> 'pools') is distinct from 'object' then
    raise exception 'A step''s positions, events and moves are lists, and its pools an object'
      using errcode = 'invalid_parameter_value';
  end if;
  perform perps.number(f.figure) from (
    select priced ->> 'price' as figure where priced is not null
    union all select funded ->> 'rate' where funded is not null
    union all select funded ->> 'openInterestLong' where funded is not null
    union all select funded ->> 'openInterestShort' where funded is not null
    union all select plan -> 'pools' ->> 'long'
    union all select plan -> 'pools' ->> 'short'
    union all select m ->> 'amount' from jsonb_array_elements(moves_in) m
    union all
    select x ->> k
    from jsonb_array_elements(positions_in) x,
         unnest(array['size', 'costBasis', 'originalCostBasis', 'takerFeeCostBasis', 'entryPrice',
                      'leverage', 'liquidationPrice']) k
    union all
    select e ->> k
    from jsonb_array_elements(events_in) e,
         unnest(array['sizeChange', 'costBasisChange', 'margin', 'fee', 'payout']) k
  ) f;

  -- The off switch and the pause, whatever the plan says.
  if p.state <> 'live' then
    raise exception 'Perp % is retired', perp using errcode = 'object_not_in_prerequisite_state';
  end if;
  if p.trading_mode = 'halted' then
    if step_kind in ('tick', 'funding') then
      raise exception 'Perp % is switched off: nothing runs', perp
        using errcode = 'object_not_in_prerequisite_state';
    end if;
    if refusal is null or refusal ->> 'code' <> 'trading_off' or priced is not null
       or jsonb_array_length(positions_in) > 0 or jsonb_array_length(events_in) > 0
       or jsonb_array_length(moves_in) > 0 then
      raise exception 'Perp % is switched off: a trade is refused, and no price is applied', perp
        using errcode = 'check_violation';
    end if;
  end if;
  if step_kind = 'open' and p.trading_mode = 'reduce-only'
     and (refusal is null or refusal ->> 'code' <> 'trading_off') then
    raise exception 'Perp % takes only closes now: an open is refused', perp
      using errcode = 'check_violation';
  end if;
  if refusal is not null and (step_kind not in ('open', 'close')
                              or not perps.is_refusal(refusal ->> 'code')
                              or coalesce(char_length(refusal ->> 'message'), 0) not between 1 and 500) then
    raise exception 'A refusal answers a trade, with one of the engine''s reasons and a message'
      using errcode = 'check_violation';
  end if;
  if funded is not null and step_kind <> 'funding' then
    raise exception 'Only the funding step funds' using errcode = 'check_violation';
  end if;
  if (step_kind = 'tick' and priced is null)
     or (step_kind = 'funding' and priced is null and funded is null) then
    raise exception 'A scheduled step with nothing to do writes nothing' using errcode = 'check_violation';
  end if;
  -- A price that can't be applied without leaving the pools short pauses trading (Manifold's
  -- solvency halt): the price moves on, the pools and positions don't, and only a later price that
  -- applies cleanly ends the pause. Meanwhile nothing trades and nothing funds.
  if coalesce(char_length(paused_after), 1) not between 1 and 1000 then
    raise exception 'Why trading is paused, in at most 1,000 characters' using errcode = 'check_violation';
  end if;
  if priced is null and paused_after is distinct from p.paused_reason then
    raise exception 'Only a new price pauses trading, or ends a pause' using errcode = 'check_violation';
  end if;
  if paused_after is not null then
    if funded is not null or (step_kind in ('open', 'close') and refusal is null) then
      raise exception 'Trading is paused: nothing trades and nothing funds' using errcode = 'check_violation';
    end if;
    if priced is not null and (
         exists (select 1 from jsonb_array_elements(events_in) e where e ->> 'phase' = 'price')
         or exists (select 1 from jsonb_array_elements(moves_in) m where m ->> 'phase' = 'price')) then
      raise exception 'A price that pauses trading changes no position and moves nothing'
        using errcode = 'check_violation';
    end if;
  end if;

  -- 1. The new price, first: its own 5-second step, never older than the last, once.
  book_price := p.price;
  book_price_at := p.price_at;
  if priced is not null then
    new_price := perps.number(priced ->> 'price');
    new_price_at := (priced ->> 'at')::timestamptz;
    if new_price <= 0 or new_price_at is null
       or new_price_at <> perps.stand_in_step(p, step_at)
       or (p.price_at is not null and new_price_at <= p.price_at) then
      raise exception 'A new price is the stand-in''s for this moment''s 5-second step, newer than the last'
        using errcode = 'check_violation';
    end if;
    book_price := new_price;
    book_price_at := new_price_at;
  end if;

  -- 2. The funding: once a period (the first a full period after it starts, each later one allowing
  -- Manifold's minute for a scheduler that runs early), inside its cap, from the open interest the
  -- database counts itself (the open positions as the new price left them), paid by the crowded
  -- side, from its pool, never more than the rate's share of it.
  if funded is not null then
    rate := perps.number(funded ->> 'rate');
    oi_long := perps.number(funded ->> 'openInterestLong');
    oi_short := perps.number(funded ->> 'openInterestShort');
    with after_price as (
      select y.direction,
             y.size + coalesce((
               select sum((e ->> 'sizeChange')::numeric)
               from jsonb_array_elements(events_in) e
               where (e ->> 'positionId')::uuid = y.id and e ->> 'phase' = 'price'), 0) as size,
             exists (
               select 1 from jsonb_array_elements(events_in) e
               where (e ->> 'positionId')::uuid = y.id and e ->> 'phase' = 'price'
                 and e ->> 'kind' in ('liquidation', 'settle')) as gone
      from perps.positions y
      where y.perp_id = perp and y.closed_at is null
    )
    select coalesce(sum(size) filter (where direction = 'long' and not gone), 0),
           coalesce(sum(size) filter (where direction = 'short' and not gone), 0)
      into counted_long, counted_short
    from after_price;
    if abs(rate) > p.max_funding_rate
       or not perps.agree(oi_long, counted_long) or not perps.agree(oi_short, counted_short)
       or (rate > 0 and oi_long <= oi_short) or (rate < 0 and oi_short <= oi_long)
       or step_at < coalesce(
             p.last_funding_at + make_interval(secs => (p.funding_period_ms - 60000) / 1000.0),
             p.funding_from + make_interval(secs => p.funding_period_ms / 1000.0)) then
      raise exception 'Funding runs once a period, inside its cap, paid by the crowded side'
        using errcode = 'check_violation';
    end if;
    if rate <> 0 then
      crowded_pool := case when rate > 0 then p.long_account_id else p.short_account_id end;
      other_pool := case when rate > 0 then p.short_account_id else p.long_account_id end;
      -- The pools as the funding found them: after the new price's own moves.
      select coalesce(sum(case when (m ->> 'to')::uuid = crowded_pool then (m ->> 'amount')::numeric
                               when (m ->> 'from')::uuid = crowded_pool then -(m ->> 'amount')::numeric
                               else 0 end), 0),
             coalesce(sum(case when (m ->> 'to')::uuid = other_pool then (m ->> 'amount')::numeric
                               when (m ->> 'from')::uuid = other_pool then -(m ->> 'amount')::numeric
                               else 0 end), 0)
        into crowded_before, other_before
      from jsonb_array_elements(moves_in) m where m ->> 'phase' = 'price';
      crowded_before := crowded_before + case when rate > 0 then pool_long_before else pool_short_before end;
      other_before := other_before + case when rate > 0 then pool_short_before else pool_long_before end;
      select coalesce(sum((m ->> 'amount')::numeric), 0) into transfer
      from jsonb_array_elements(moves_in) m
      where m ->> 'phase' = 'funding' and (m ->> 'from')::uuid = crowded_pool
        and (m ->> 'to')::uuid = other_pool;
      if transfer > abs(rate) * crowded_before + 0.000001 or (transfer > 0 and other_before <= 0) then
        raise exception 'Funding moves at most its rate of the crowded side''s pool'
          using errcode = 'check_violation';
      end if;
      -- When it moves money, every position the new price left open is scaled by it. (With either
      -- pool empty, Manifold's funding moves nothing and scales nothing.)
      if transfer > 0 and exists (
        select 1 from perps.positions y
        where y.perp_id = perp and y.closed_at is null
          and not exists (
            select 1 from jsonb_array_elements(events_in) e
            where (e ->> 'positionId')::uuid = y.id and e ->> 'phase' = 'price'
              and e ->> 'kind' in ('liquidation', 'settle'))
          and not exists (
            select 1 from jsonb_array_elements(events_in) e
            where (e ->> 'positionId')::uuid = y.id and e ->> 'phase' = 'funding'
              and e ->> 'kind' = 'funding')
      ) then
        raise exception 'Funding scales every open position' using errcode = 'check_violation';
      end if;
    elsif exists (select 1 from jsonb_array_elements(events_in) e where e ->> 'phase' = 'funding')
          or exists (select 1 from jsonb_array_elements(moves_in) m where m ->> 'phase' = 'funding') then
      raise exception 'Funding at a rate of zero changes nothing' using errcode = 'check_violation';
    end if;
  end if;

  -- 3. Every position the step changed: named once, each still its perp's, owner's and side's, a new
  -- one only the trader's own open, made now at the price; and every event on one of them, in a phase
  -- the step has, one a phase (funding may scale a position down after scaling it, or settle it),
  -- with nothing after it closes.
  if (select count(*) from jsonb_array_elements(positions_in))
     <> (select count(distinct (y ->> 'id')::uuid) from jsonb_array_elements(positions_in) y) then
    raise exception 'The step names a position more than once' using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from jsonb_array_elements(events_in) e
    where not exists (select 1 from jsonb_array_elements(positions_in) y
                      where (y ->> 'id')::uuid = (e ->> 'positionId')::uuid)
       or e ->> 'phase' is null
       or (e ->> 'phase' = 'price' and priced is null)
       or (e ->> 'phase' = 'funding' and funded is null)
       or (e ->> 'phase' = 'trade' and (step_kind not in ('open', 'close') or refusal is not null))
       or e ->> 'phase' not in ('price', 'funding', 'trade')
  ) then
    raise exception 'An event on a position the step doesn''t name, or in a phase it doesn''t have'
      using errcode = 'check_violation';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(events_in) e
    group by (e ->> 'positionId')::uuid, e ->> 'phase'
    having count(*) > case when e ->> 'phase' = 'funding' then 2 else 1 end
  ) then
    raise exception 'One event a phase for each position' using errcode = 'check_violation';
  end if;

  for item in select value from jsonb_array_elements(positions_in) loop
    select * into prior from perps.positions y where y.id = (item ->> 'id')::uuid;
    if prior.id is not null then
      if prior.perp_id <> perp or prior.account_id <> (item ->> 'accountId')::uuid
         or prior.direction <> item ->> 'direction' or prior.closed_at is not null then
        raise exception 'Position % is not an open position of this perp''s, as named', prior.id
          using errcode = 'check_violation';
      end if;
    elsif step_kind <> 'open' or refusal is not null
          or (item ->> 'accountId')::uuid is distinct from trader
          or item ->> 'direction' is distinct from asking ->> 'direction'
          or item ->> 'closeReason' is not null
          or (item ->> 'openedAt')::timestamptz is distinct from step_at
          or (item ->> 'entryPrice')::numeric is distinct from book_price then
      raise exception 'A new position is only the trader''s own open, made now at the price'
        using errcode = 'check_violation';
    end if;
    if item ->> 'direction' not in ('long', 'short') then
      raise exception 'A position is long or short' using errcode = 'check_violation';
    end if;

    -- Its events, in the order they happened, from what it was as the step began.
    size_now := coalesce(prior.size, 0);
    margin_now := coalesce(prior.cost_basis, 0);
    entry := coalesce(prior.entry_price, book_price);
    closed_by := null;
    added := false;
    funded_once := false;
    if not exists (select 1 from jsonb_array_elements(events_in) e
                   where (e ->> 'positionId')::uuid = (item ->> 'id')::uuid) then
      raise exception 'Position % changed with no event to say how', item ->> 'id'
        using errcode = 'check_violation';
    end if;
    for ev in
      select e.value
      from jsonb_array_elements(events_in) with ordinality as e (value, n)
      where (e.value ->> 'positionId')::uuid = (item ->> 'id')::uuid
      order by case e.value ->> 'phase' when 'price' then 1 when 'funding' then 2 else 3 end, e.n
    loop
      if closed_by is not null then
        raise exception 'An event on position % after it closed', item ->> 'id'
          using errcode = 'check_violation';
      end if;
      change_size := (ev ->> 'sizeChange')::numeric;
      change_margin := (ev ->> 'costBasisChange')::numeric;
      case ev ->> 'kind'
        when 'liquidation' then
          -- All of it, only where the new price reached its liquidation price; its margin stays in
          -- the pool, and nothing is paid.
          if prior.id is null or new_price is null
             or not perps.agree(change_size, -size_now) or not perps.agree(change_margin, -margin_now)
             or (case prior.direction when 'long' then new_price > prior.liquidation_price
                                      else new_price < prior.liquidation_price end) then
            raise exception 'A liquidation only where the price reached the position''s liquidation price'
              using errcode = 'check_violation';
          end if;
          closed_by := 'liquidated';
          liquidations := liquidations + 1;
        when 'settle' then
          -- A winner scaled down to nothing when the pools ran short: all of it, its margin paid back
          -- (less, at most, a hair of the pool's own rounding). In the funding phase, only after the
          -- funding scaled it.
          if prior.id is null or (ev ->> 'phase' = 'funding' and not funded_once)
             or not (case prior.direction when 'long' then book_price > prior.entry_price
                                          else book_price < prior.entry_price end)
             or not perps.agree(change_size, -size_now) or not perps.agree(change_margin, -margin_now)
             or (ev ->> 'payout')::numeric > margin_now + 0.000001
             or (ev ->> 'payout')::numeric < margin_now - 0.0001 then
            raise exception 'A settlement pays back a winner''s margin, no more'
              using errcode = 'check_violation';
          end if;
          closed_by := 'settled';
        when 'adl' then
          -- A winner scaled down: its size shrinks, its margin doesn't change. Only a winner: a
          -- position the price went against is liquidated, never scaled out of reach of its
          -- liquidation price. In the funding phase, only after the funding scaled it.
          if prior.id is null or (ev ->> 'phase' = 'funding' and not funded_once)
             or not (case prior.direction when 'long' then book_price > prior.entry_price
                                          else book_price < prior.entry_price end)
             or change_size > 0 or -change_size >= size_now
             or abs(change_margin) > 1e-9 * greatest(margin_now, 1) then
            raise exception 'Scaling down a winner shrinks its size alone'
              using errcode = 'check_violation';
          end if;
          size_now := size_now + change_size;
          margin_now := margin_now + change_margin;
        when 'funding' then
          -- Size and margin scaled alike: the crowded side's by exactly one less the rate, the other's
          -- up by no more than what its pool received.
          if prior.id is null or ev ->> 'phase' <> 'funding' or size_now <= 0 or margin_now <= 0
             or transfer = 0 or funded_once then
            raise exception 'Funding scales an open position once, and only when it moves money'
              using errcode = 'check_violation';
          end if;
          funded_once := true;
          factor := (size_now + change_size) / size_now;
          if not perps.agree((margin_now + change_margin) / margin_now, factor)
             or (case when (prior.direction = 'long') = (rate > 0)
                      then not perps.agree(factor, 1 - abs(rate))
                      else factor < 1 - 1e-9
                           or (transfer > 0
                               and factor - 1 > (transfer + 0.000001) / nullif(other_before, 0) + 1e-12)
                 end) then
            raise exception 'Funding scales a position''s size and margin alike, by its rate'
              using errcode = 'check_violation';
          end if;
          size_now := size_now + change_size;
          margin_now := margin_now + change_margin;
        when 'open', 'add' then
          -- Only the trader's own open: a new position, or more of the one on their side.
          added_size := change_size;
          if ev ->> 'phase' <> 'trade' or step_kind <> 'open'
             or (item ->> 'accountId')::uuid is distinct from trader
             or item ->> 'direction' is distinct from asking ->> 'direction'
             or (ev ->> 'kind' = 'add') <> (prior.id is not null)
             or change_size <= 0 or change_margin <= 0 then
            raise exception 'Only the trader''s own open opens or adds to a position'
              using errcode = 'check_violation';
          end if;
          size_now := size_now + change_size;
          margin_now := margin_now + change_margin;
          added := true;
        when 'close' then
          -- The trader's own position (or, in an open, their other side, closed by a flip), all or
          -- part: a part takes its share of the margin; all of it, the whole margin; paid at most
          -- what the closed part is worth at the price.
          if ev ->> 'phase' <> 'trade' or prior.id is null
             or (item ->> 'accountId')::uuid is distinct from trader
             or (step_kind = 'close' and asking ->> 'direction' is not null
                 and asking ->> 'direction' <> prior.direction)
             or (step_kind = 'open' and asking ->> 'direction' = prior.direction)
             or change_size >= 0 or -change_size > size_now * (1 + 1e-9) or change_margin > 0 then
            raise exception 'Only the trader''s own position closes, all or part'
              using errcode = 'check_violation';
          end if;
          equity := case prior.direction
                      when 'long' then (book_price - prior.entry_price) / prior.entry_price
                      else (prior.entry_price - book_price) / prior.entry_price end
                    * -change_size;
          if (ev ->> 'payout')::numeric > greatest(-change_margin + equity, 0) + 0.000001 then
            raise exception 'A close pays at most what the position is worth at the price'
              using errcode = 'check_violation';
          end if;
          closed_direction := prior.direction;
          closed_margin := -change_margin;
          closed_equity := equity;
          if step_kind = 'close' and asking ->> 'fraction' is null then
            raise exception 'A close says what share of the position it closes'
              using errcode = 'check_violation';
          end if;
          if perps.agree(-change_size, size_now) then
            -- All of it: what was asked, or a part whose remainder would be under Ṁ0.01 of margin,
            -- which Manifold closes whole (PERP_MIN_REMAINDER_COST_BASIS).
            if not perps.agree(-change_margin, margin_now)
               or (step_kind = 'close'
                   and not perps.agree(perps.number(asking ->> 'fraction'), 1)
                   and margin_now * (1 - perps.number(asking ->> 'fraction')) >= 0.01) then
              raise exception 'Closing all of a position takes all its margin, and only when asked'
                using errcode = 'check_violation';
            end if;
            closed_by := case when step_kind = 'open' then 'flipped' else 'closed' end;
          else
            if step_kind = 'open' or not perps.agree(-change_margin, margin_now * -change_size / size_now)
               or asking ->> 'fraction' is null
               or not perps.agree(-change_size / size_now, perps.number(asking ->> 'fraction')) then
              raise exception 'Closing part of a position takes the share asked, and that share of its margin'
                using errcode = 'check_violation';
            end if;
            size_now := size_now + change_size;
            margin_now := margin_now + change_margin;
          end if;
        else
          raise exception 'Unknown event %', ev ->> 'kind' using errcode = 'check_violation';
      end case;
    end loop;

    -- The position as written is what its events made of it: a closed one as it stood when it
    -- closed; an open one's leverage and liquidation price following from its figures, its entry price
    -- moving only when it's added to (to between its old one and the price).
    if (item ->> 'closeReason') is distinct from closed_by
       or not perps.agree((item ->> 'size')::numeric, size_now)
       or not perps.agree((item ->> 'costBasis')::numeric, margin_now) then
      raise exception 'Position % as written is not what its events make of it', item ->> 'id'
        using errcode = 'check_violation';
    end if;
    -- (Adding Q at the price P to size S at entry E gives the entry (S + Q) / (S / E + Q / P), the
    -- units-weighted mean Manifold's mergedEntryPrice uses, so the merged position is worth what
    -- the two would have been.)
    if (not added and (item ->> 'entryPrice')::numeric is distinct from prior.entry_price
                  and prior.id is not null)
       or (added and prior.id is not null
           and not perps.agree((item ->> 'entryPrice')::numeric,
                               size_now / ((size_now - added_size) / prior.entry_price
                                           + added_size / book_price))) then
      raise exception 'A position''s entry price moves only when it''s added to'
        using errcode = 'check_violation';
    end if;
    if closed_by is null and (
         (item ->> 'size')::numeric <= 0 or (item ->> 'costBasis')::numeric <= 0
         or not perps.agree((item ->> 'leverage')::numeric,
                            (item ->> 'size')::numeric / (item ->> 'costBasis')::numeric)
         or not perps.agree((item ->> 'liquidationPrice')::numeric,
                            case item ->> 'direction'
                              when 'long' then (1 - 1 / (item ->> 'leverage')::numeric)
                              else (1 + 1 / (item ->> 'leverage')::numeric) end
                            * (item ->> 'entryPrice')::numeric)) then
      raise exception 'An open position''s leverage and liquidation price follow from its figures'
        using errcode = 'check_violation';
    end if;
  end loop;

  -- 4. A trade's own rules. An open: exactly the margin asked, at the leverage asked, within the
  -- cap; a fee of at most what the trader accepts (which they must say while the size fee is on) and
  -- less than half the margin. A close: one close, of the trader's own. Either: a fill only at a fresh
  -- price published after the order was placed.
  if step_kind = 'open' and refusal is null then
    select e into opening
    from jsonb_array_elements(events_in) e
    where e ->> 'phase' = 'trade' and e ->> 'kind' in ('open', 'add');
    select y into opened
    from jsonb_array_elements(positions_in) y
    where (y ->> 'accountId')::uuid = trader and y ->> 'closeReason' is null
      and (y ->> 'id')::uuid = (opening ->> 'positionId')::uuid;
    if (select count(*) from jsonb_array_elements(events_in) e
        where e ->> 'phase' = 'trade' and e ->> 'kind' in ('open', 'add')) <> 1
       or opened is null
       or asking ->> 'leverage' is null or asking ->> 'margin' is null
       or perps.number(asking ->> 'leverage') < 1
       or perps.number(asking ->> 'leverage') > p.max_leverage
       or (opening ->> 'margin')::numeric is distinct from perps.number(asking ->> 'margin')
       or (opening ->> 'fee')::numeric >= (opening ->> 'margin')::numeric * 0.5
       or (p.taker_fee_impact > 0 and asking ->> 'maxFee' is null)
       or (asking ->> 'maxFee' is not null
           and (opening ->> 'fee')::numeric > perps.number(asking ->> 'maxFee'))
       or not perps.agree((opening ->> 'sizeChange')::numeric,
                          (opening ->> 'margin')::numeric * (asking ->> 'leverage')::numeric)
       or not perps.agree((opening ->> 'costBasisChange')::numeric, (opening ->> 'margin')::numeric)
       or (opened ->> 'leverage')::numeric > p.max_leverage * (1 + 1e-9) then
      raise exception 'The open does not match its request, or breaks the perp''s rules'
        using errcode = 'check_violation';
    end if;
  elsif step_kind = 'close' and refusal is null then
    if (select count(*) from jsonb_array_elements(events_in) e where e ->> 'phase' = 'trade') <> 1
       or (select count(*) from jsonb_array_elements(events_in) e
           where e ->> 'phase' = 'trade' and e ->> 'kind' = 'close') <> 1 then
      raise exception 'A close closes one position, the trader''s own' using errcode = 'check_violation';
    end if;
  end if;
  if step_kind in ('open', 'close') and refusal is null
     and (book_price_at is null or book_price_at <= placed
          or step_at - book_price_at > make_interval(secs => p.max_price_age_ms / 1000.0)) then
    raise exception 'An order fills only at a fresh price published after it was placed'
      using errcode = 'check_violation';
  end if;

  -- 5. The money: every move between this perp's pools and people; each person paid only if they
  -- held a position (or are the trader), and charged only if they're the trader, in the trade; pools
  -- move to each other only where the maths balances them (winners scaled down, or funding); and
  -- each person's moves in each phase exactly what their events say.
  if exists (
    select 1
    from jsonb_array_elements(moves_in) m
    left join ledger.accounts t on t.id = (m ->> 'to')::uuid
    left join ledger.accounts f on f.id = (m ->> 'from')::uuid
    where m ->> 'phase' is null or m ->> 'phase' not in ('price', 'funding', 'trade')
       or (m ->> 'phase' = 'price' and priced is null)
       or (m ->> 'phase' = 'funding' and funded is null)
       or (m ->> 'phase' = 'trade' and (step_kind not in ('open', 'close') or refusal is not null))
       or t.id is null or f.id is null
       or not (t.kind = 'person' or t.id in (p.long_account_id, p.short_account_id))
       or not (f.kind = 'person' or f.id in (p.long_account_id, p.short_account_id))
       or (t.kind = 'person' and not (t.id = any (owners) or t.id is not distinct from trader))
       or (f.kind = 'person' and (f.id is distinct from trader or m ->> 'phase' <> 'trade'))
       or (f.kind <> 'person' and t.kind <> 'person'
           and (m ->> 'phase' = 'trade'
                or (m ->> 'phase' = 'price' and not exists (
                      select 1 from jsonb_array_elements(events_in) e
                      where e ->> 'phase' = 'price' and e ->> 'kind' in ('adl', 'settle')))))
  ) then
    raise exception 'A move to or from someone the step can''t pay or charge'
      using errcode = 'check_violation';
  end if;
  -- An open's margin and fee go into the trader's own side's pool, and a close puts nothing in;
  -- a close's payout comes from its own side's pool (at most the margin it closed) and the other's
  -- (at most its profit); funding moves only from the crowded side's pool to the other; and a pool
  -- topped up by the other when winners are scaled down ends no higher than its own side's margins.
  if exists (
    select 1 from jsonb_array_elements(moves_in) m
    where m ->> 'phase' = 'trade' and (m ->> 'from')::uuid is not distinct from trader
      and (step_kind <> 'open'
           or (m ->> 'to')::uuid is distinct from
              case asking ->> 'direction' when 'long' then p.long_account_id
                                          when 'short' then p.short_account_id end)
  ) or (
    closed_direction is not null and (
      (select coalesce(sum((m ->> 'amount')::numeric), 0) from jsonb_array_elements(moves_in) m
       where m ->> 'phase' = 'trade' and (m ->> 'to')::uuid is not distinct from trader
         and (m ->> 'from')::uuid = case closed_direction when 'long' then p.long_account_id
                                                          else p.short_account_id end)
        > closed_margin + 0.000001
      or (select coalesce(sum((m ->> 'amount')::numeric), 0) from jsonb_array_elements(moves_in) m
          where m ->> 'phase' = 'trade' and (m ->> 'to')::uuid is not distinct from trader
            and (m ->> 'from')::uuid = case closed_direction when 'long' then p.short_account_id
                                                             else p.long_account_id end)
        > greatest(closed_equity, 0) + 0.000001)
  ) or exists (
    select 1 from jsonb_array_elements(moves_in) m
    where m ->> 'phase' = 'funding'
      and (m ->> 'from')::uuid in (p.long_account_id, p.short_account_id)
      and (m ->> 'to')::uuid in (p.long_account_id, p.short_account_id)
      and ((m ->> 'from')::uuid is distinct from crowded_pool
           or (m ->> 'to')::uuid is distinct from other_pool)
  ) or exists (
    select 1
    from (values ('long', p.long_account_id, pool_long_before),
                 ('short', p.short_account_id, pool_short_before)) as pool (side, account, before)
    where exists (
            select 1 from jsonb_array_elements(moves_in) m
            where m ->> 'phase' = 'price' and (m ->> 'to')::uuid = pool.account
              and (m ->> 'from')::uuid in (p.long_account_id, p.short_account_id))
      and pool.before
          + (select coalesce(sum(case when (m ->> 'to')::uuid = pool.account then (m ->> 'amount')::numeric
                                      else -(m ->> 'amount')::numeric end), 0)
             from jsonb_array_elements(moves_in) m
             where m ->> 'phase' = 'price'
               and pool.account in ((m ->> 'to')::uuid, (m ->> 'from')::uuid))
          > (select coalesce(sum(y.cost_basis), 0) from perps.positions y
             where y.perp_id = perp and y.closed_at is null and y.direction = pool.side) + 0.000001
  ) then
    raise exception 'A move between the wrong pool and person, or more than the maths allows'
      using errcode = 'check_violation';
  end if;
  if exists (
    with flows as (
      select m ->> 'phase' as phase, (m ->> 'to')::uuid as account, (m ->> 'amount')::numeric as amount
      from jsonb_array_elements(moves_in) m
      union all
      select m ->> 'phase', (m ->> 'from')::uuid, -(m ->> 'amount')::numeric
      from jsonb_array_elements(moves_in) m
    ),
    by_money as (
      select f.phase, f.account,
             sum(f.amount) filter (where f.amount > 0) as paid_in,
             -sum(f.amount) filter (where f.amount < 0) as paid_out
      from flows f join ledger.accounts a on a.id = f.account and a.kind = 'person'
      group by f.phase, f.account
    ),
    by_events as (
      select e ->> 'phase' as phase,
             (select (y ->> 'accountId')::uuid from jsonb_array_elements(positions_in) y
              where (y ->> 'id')::uuid = (e ->> 'positionId')::uuid) as account,
             sum((e ->> 'payout')::numeric) as paid_in,
             sum((e ->> 'margin')::numeric + (e ->> 'fee')::numeric) as paid_out
      from jsonb_array_elements(events_in) e
      group by 1, 2
    )
    -- Each way, not just net: money paid to a person is exactly their payouts, and money they pay
    -- exactly their margin and fees, so no leg in and out again can carry money between the pools.
    select 1
    from by_money m full join by_events e on e.phase = m.phase and e.account = m.account
    where coalesce(m.paid_in, 0) <> coalesce(e.paid_in, 0)
       or coalesce(m.paid_out, 0) <> coalesce(e.paid_out, 0)
  ) then
    raise exception 'The step''s moves and its events don''t agree' using errcode = 'check_violation';
  end if;

  -- 6. Write it all: the price, the positions (those that change or close first, so a flip's new
  -- position never meets the one it replaces), the events, the moves, the funding, the book.
  if priced is not null then
    insert into perps.prices (perp_id, at, price, step, applied_at, liquidations)
    values (perp, new_price_at, new_price, step_no, step_at, liquidations);
  end if;

  for item in
    select x.value
    from jsonb_array_elements(positions_in) with ordinality as x (value, n)
    order by (exists (select 1 from perps.positions y where y.id = (x.value ->> 'id')::uuid)) desc, x.n
  loop
    insert into perps.positions as y (
      id, perp_id, account_id, direction, size, cost_basis, original_cost_basis,
      taker_fee_cost_basis, entry_price, leverage, liquidation_price, opened_at, updated_at,
      closed_at, close_reason)
    values (
      (item ->> 'id')::uuid, perp, (item ->> 'accountId')::uuid, item ->> 'direction',
      (item ->> 'size')::numeric, (item ->> 'costBasis')::numeric,
      (item ->> 'originalCostBasis')::numeric, (item ->> 'takerFeeCostBasis')::numeric,
      (item ->> 'entryPrice')::numeric, (item ->> 'leverage')::numeric,
      (item ->> 'liquidationPrice')::numeric,
      (item ->> 'openedAt')::timestamptz, step_at,
      case when item ->> 'closeReason' is not null then step_at end, item ->> 'closeReason')
    on conflict (id) do update set
      size = excluded.size, cost_basis = excluded.cost_basis,
      original_cost_basis = excluded.original_cost_basis,
      taker_fee_cost_basis = excluded.taker_fee_cost_basis, entry_price = excluded.entry_price,
      leverage = excluded.leverage, liquidation_price = excluded.liquidation_price,
      updated_at = excluded.updated_at, closed_at = excluded.closed_at,
      close_reason = excluded.close_reason;
  end loop;

  insert into perps.events (perp_id, step, phase, kind, position_id, account_id, at, price,
                            size_change, cost_basis_change, margin, fee, payout, request_id)
  select perp, step_no, e ->> 'phase', e ->> 'kind', (e ->> 'positionId')::uuid,
         (select (y ->> 'accountId')::uuid from jsonb_array_elements(positions_in) y
          where (y ->> 'id')::uuid = (e ->> 'positionId')::uuid),
         step_at, book_price, (e ->> 'sizeChange')::numeric, (e ->> 'costBasisChange')::numeric,
         (e ->> 'margin')::numeric(20, 6), (e ->> 'fee')::numeric(20, 6),
         (e ->> 'payout')::numeric(20, 6), request
  from jsonb_array_elements(events_in) with ordinality as t (e, n)
  order by case t.e ->> 'phase' when 'price' then 1 when 'funding' then 2 else 3 end, t.n;

  foreach phase_name in array array['price', 'funding', 'trade'] loop
    if exists (select 1 from jsonb_array_elements(moves_in) m where m ->> 'phase' = phase_name) then
      perform ledger.post_perp('perp_' || phase_name, perp, null, (
        select jsonb_agg(m - 'phase')
        from jsonb_array_elements(moves_in) m where m ->> 'phase' = phase_name));
    end if;
  end loop;

  select a.balance into pool_long_after from ledger.accounts a where a.id = p.long_account_id;
  select a.balance into pool_short_after from ledger.accounts a where a.id = p.short_account_id;
  if pool_long_after is distinct from (plan -> 'pools' ->> 'long')::numeric
     or pool_short_after is distinct from (plan -> 'pools' ->> 'short')::numeric then
    raise exception 'The pools would hold % and %, but the plan says % and %',
      pool_long_after, pool_short_after, plan -> 'pools' ->> 'long', plan -> 'pools' ->> 'short'
      using errcode = 'check_violation';
  end if;

  if funded is not null then
    insert into perps.fundings (perp_id, step, at, rate, price, open_interest_long,
                                open_interest_short, pool_long_before, pool_short_before,
                                pool_long_after, pool_short_after)
    values (perp, step_no, step_at, rate, book_price, oi_long, oi_short, pool_long_before,
            pool_short_before, pool_long_after, pool_short_after);
  end if;

  -- Nobody left open past their liquidation price, unless the new price couldn't be applied.
  if paused_after is null and book_price is not null and exists (
    select 1 from perps.positions y
    where y.perp_id = perp and y.closed_at is null
      and case y.direction when 'long' then book_price <= y.liquidation_price
                           else book_price >= y.liquidation_price end
  ) then
    raise exception 'A position is left open past its liquidation price' using errcode = 'check_violation';
  end if;

  update perps.perps y
  set price = book_price,
      price_at = book_price_at,
      last_funding_at = case when funded is not null then step_at else y.last_funding_at end,
      paused_reason = paused_after,
      steps = step_no,
      updated_at = step_at
  where y.id = perp;
  -- One begin, one apply: the next step starts again with begin_step.
  perform set_config('perps.stepping', '', true);

  -- 7. The answer: a trade's, stored under its request; a scheduled step's, just returned.
  if step_kind in ('open', 'close') then
    select coalesce(sum((e ->> 'margin')::numeric), 0), coalesce(sum((e ->> 'fee')::numeric), 0),
           coalesce(sum((e ->> 'payout')::numeric), 0)
      into trader_margin, trader_fee, trader_payout
    from jsonb_array_elements(events_in) e
    where e ->> 'phase' = 'trade';
    result := jsonb_build_object(
      'status', case
        when refusal is not null then 'refused'
        when step_kind = 'close' then 'closed'
        when exists (select 1 from jsonb_array_elements(events_in) e
                     where e ->> 'phase' = 'trade' and e ->> 'kind' = 'add') then 'added'
        else 'opened' end,
      'request_id', request,
      'perp_id', perp,
      'action', step_kind,
      'step', step_no,
      'at', markets.utc(step_at),
      'placed_at', markets.utc(placed),
      'price', book_price::text,
      'price_at', markets.utc(book_price_at),
      'margin', trader_margin::numeric(20, 6)::text,
      'fee', trader_fee::numeric(20, 6)::text,
      'payout', trader_payout::numeric(20, 6)::text,
      'position', (select perps.position_of(y) from perps.positions y
                   where y.perp_id = perp and y.account_id = trader and y.closed_at is null),
      'balance', (select a.balance::text from ledger.accounts a where a.id = trader)
    ) || case when refusal is not null then jsonb_build_object(
      'refusal', jsonb_build_object('code', refusal ->> 'code', 'message', refusal ->> 'message'))
      else '{}'::jsonb end;
    insert into perps.requests (account_id, id, perp_id, action, params, placed_at, result)
    values (trader, request, perp, step_kind, asking, placed, result);
  else
    result := jsonb_build_object(
      'perp_id', perp,
      'action', step_kind,
      'step', step_no,
      'at', markets.utc(step_at),
      'price', book_price::text,
      'price_at', markets.utc(book_price_at),
      'liquidations', liquidations,
      'funded', funded is not null,
      'rate', rate::text,
      'paused_reason', paused_after
    );
  end if;
  return result;
end;
$$;

-- The perps the scheduled jobs have work on: live, not switched off, with an open position (with
-- none, a new price has nothing to liquidate and funding nothing to move); for funding, also due.
create function perps.due(job text)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(p.id order by p.id), '{}')
  from perps.perps p
  where job in ('tick', 'funding')
    and p.state = 'live'
    and p.trading_mode <> 'halted'
    and exists (select 1 from perps.positions x where x.perp_id = p.id and x.closed_at is null)
    and (job = 'tick' or clock_timestamp() >= coalesce(
           p.last_funding_at + make_interval(secs => (p.funding_period_ms - 60000) / 1000.0),
           p.funding_from + make_interval(secs => p.funding_period_ms / 1000.0)));
$$;


-- 6. Reads for everyone --------------------------------------------------------------------------------

-- One perp, as anyone may see it, by its address (an unlisted test perp too, as an unlisted market
-- is); null for no such perp.
create function perps.details(perp uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select perps.view(details.perp, false);
$$;

-- Where perps' prices come from, for the server to work out each one's price now: the stand-in's walk
-- (its start, start price and volatility) and, for a check run's test perp only, its own seed. The
-- listed perp's seed is the environment's secret, never in the database. For the server alone (the
-- app's role); never in what anyone else is shown. `ids` null: every live perp.
create function perps.price_sources(ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(p.id, jsonb_build_object(
    'feed', p.feed,
    'seed', p.stand_in_seed,
    'standIn', jsonb_build_object(
      'origin', markets.utc(p.stand_in_origin),
      'startPrice', p.stand_in_start_price::text,
      'volatility', p.stand_in_volatility::text))), '{}'::jsonb)
  from perps.perps p
  where (ids is null and p.state = 'live') or p.id = any (ids);
$$;

-- The listed perps (the Bitcoin perp), oldest first.
create function perps.listed()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(perps.view(p.id, false) order by p.created_at, p.id), '[]'::jsonb)
  from perps.perps p
  where p.listed and p.state = 'live';
$$;

-- The signed-in person's open perp positions, newest first, up to `max_count` at a time after the
-- position `after_position`, each with its perp's name and book. Answers {"balance", "positions",
-- "next"}; nobody signed in, or no play money yet, answers a balance of zero and no positions.
create function perps.positions(after_position uuid, max_count integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  account uuid;
  ids uuid[];
begin
  if max_count is null or max_count not between 1 and 100 then
    raise exception 'A page holds 1 to 100 positions' using errcode = 'invalid_parameter_value';
  end if;
  select a.id into account from ledger.accounts a where a.kind = 'person' and a.user_id = auth.uid();
  if after_position is not null and not exists (
    select 1 from perps.positions x where x.id = after_position and x.account_id = account
  ) then
    raise exception 'That page doesn''t start at one of your positions'
      using errcode = 'invalid_parameter_value';
  end if;
  select coalesce(array_agg(y.id order by y.opened_at desc, y.id desc), '{}') into ids
  from (
    select x.id, x.opened_at
    from perps.positions x
    where x.account_id = account and x.closed_at is null
      and (after_position is null or (x.opened_at, x.id) < (
        select z.opened_at, z.id from perps.positions z where z.id = after_position))
    order by x.opened_at desc, x.id desc
    limit max_count + 1
  ) y;
  return jsonb_build_object(
    'balance', coalesce((select a.balance from ledger.accounts a where a.id = account), 0)::text,
    'positions', coalesce((
      select jsonb_agg(perps.position_of(x) || jsonb_build_object(
               'perpId', p.id, 'perpName', p.name, 'tradingMode', p.trading_mode,
               'price', p.price::text, 'priceAt', markets.utc(p.price_at))
             order by i.n)
      from unnest(ids[1:max_count]) with ordinality as i (id, n)
      join perps.positions x on x.id = i.id
      join perps.perps p on p.id = x.perp_id), '[]'::jsonb),
    'next', case when cardinality(ids) > max_count then ids[max_count] end
  );
end;
$$;


-- 7. The console's calls (admins only, every change logged) -----------------------------------------------

-- The perps: the listed ones first (the Bitcoin perp), on the first page only, whatever the check
-- runs have made since; then the check runs' test perps, newest first (their IDs are version 7
-- UUIDs, which sort by when they were made), up to `max_count` at a time after the test perp
-- `after_perp`. Answers {"perps": [...], "next"}.
create function admin.perps(after_perp uuid, max_count integer)
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
    raise exception 'A page holds 1 to 100 perps' using errcode = 'invalid_parameter_value';
  end if;
  select coalesce(array_agg(y.id order by y.id desc), '{}') into ids
  from (
    select p.id from perps.perps p
    where not p.listed and (after_perp is null or p.id < after_perp)
    order by p.id desc
    limit max_count + 1
  ) y;
  return jsonb_build_object(
    'perps', coalesce((
      select jsonb_agg(perps.view(x.id, true) order by x.first, x.n)
      from (
        select p.id, 0 as first, row_number() over (order by p.created_at, p.id) as n
        from perps.perps p
        where p.listed and after_perp is null
        union all
        select i.id, 1, i.n from unnest(ids[1:max_count]) with ordinality as i (id, n)
      ) x), '[]'::jsonb),
    'next', case when cardinality(ids) > max_count then ids[max_count] end
  );
end;
$$;

-- One perp, with its rule-change log.
create function admin.perp(perp uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  who uuid := private.signed_in_admin();
  found_perp jsonb := perps.view(perp, true);
begin
  if found_perp is null then
    raise exception 'No such perp' using errcode = 'no_data_found';
  end if;
  return found_perp || jsonb_build_object('log', perps.log_of(perp));
end;
$$;

-- The off switch: on (enabled), closing only (reduce-only) or halted (off), at once, after any step
-- in flight on the perp, with the reason in the log. The same mode again changes nothing.
create function admin.set_perp_mode(perp uuid, mode text, reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid := private.signed_in_admin();
  p perps.perps;
  changed_at timestamptz;
begin
  select * into p from perps.perps x where x.id = set_perp_mode.perp for update;
  if not found then
    raise exception 'No such perp' using errcode = 'no_data_found';
  end if;
  if p.state <> 'live' then
    raise exception 'Perp % is retired', p.id using errcode = 'object_not_in_prerequisite_state';
  end if;
  if mode is null or mode not in ('enabled', 'reduce-only', 'halted') then
    raise exception 'The off switch is enabled, reduce-only or halted'
      using errcode = 'invalid_parameter_value';
  end if;
  if reason is null or char_length(btrim(reason)) = 0 then
    raise exception 'Every rule change says why' using errcode = 'invalid_parameter_value';
  end if;
  if mode <> p.trading_mode then
    changed_at := date_trunc('milliseconds', greatest(clock_timestamp(), p.updated_at));
    update perps.perps x set trading_mode = mode, updated_at = changed_at where x.id = p.id;
    insert into perps.rule_changes (perp_id, at, by_account, rule, old_value, new_value, reason)
    values (p.id, changed_at, who, 'trading_mode', p.trading_mode, mode, reason);
  end if;
  return perps.view(p.id, true) || jsonb_build_object('log', perps.log_of(p.id));
end;
$$;

-- Changes some of a perp's settings, each within Manifold's bounds and the 10-times cap (the table's
-- own rules), with the reason in the log, a line for each setting that changes. settings: {name:
-- value} by the engine's names; the subsidies are set when a perp is made and never change.
create function admin.set_perp_settings(perp uuid, settings jsonb, reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid := private.signed_in_admin();
  p perps.perps;
  changed_at timestamptz;
  setting text;
  old_text text;
  new_text text;
  column_name text;
begin
  select * into p from perps.perps x where x.id = set_perp_settings.perp for update;
  if not found then
    raise exception 'No such perp' using errcode = 'no_data_found';
  end if;
  if p.state <> 'live' then
    raise exception 'Perp % is retired', p.id using errcode = 'object_not_in_prerequisite_state';
  end if;
  if settings is null or jsonb_typeof(settings) <> 'object'
     or (select count(*) from jsonb_object_keys(settings)) = 0
     or exists (select 1 from jsonb_object_keys(settings) k where perps.setting_column(k) is null)
     or exists (select 1 from jsonb_each(settings) v where jsonb_typeof(v.value) <> 'string') then
    raise exception 'Settings are named as the engine names them, each as text; the subsidies never change'
      using errcode = 'invalid_parameter_value';
  end if;
  if reason is null or char_length(btrim(reason)) = 0 then
    raise exception 'Every rule change says why' using errcode = 'invalid_parameter_value';
  end if;
  changed_at := date_trunc('milliseconds', greatest(clock_timestamp(), p.updated_at));
  for setting in select k from jsonb_object_keys(settings) k order by k loop
    column_name := perps.setting_column(setting);
    old_text := perps.settings_of(p) ->> setting;
    new_text := settings ->> setting;
    if new_text::numeric <> old_text::numeric then
      execute format('update perps.perps x set %I = $1::%s, updated_at = $2 where x.id = $3',
                     column_name,
                     case when column_name in ('funding_period_ms', 'max_price_age_ms') then 'bigint'
                          else 'numeric' end)
        using new_text, changed_at, p.id;
      select * into p from perps.perps x where x.id = p.id;
      insert into perps.rule_changes (perp_id, at, by_account, rule, old_value, new_value, reason)
      values (p.id, changed_at, who, column_name, old_text, perps.settings_of(p) ->> setting, reason);
    end if;
  end loop;
  return perps.view(p.id, true) || jsonb_build_object('log', perps.log_of(p.id));
end;
$$;

-- A check run's own test perp (blueprint section 11: each run owns what it changes): unlisted, with
-- its own seed and price walk, halted until the run switches it on, its pools seeded by the house.
-- The caller chooses its ID (a version 7 UUID), so a retried request gets back the perp its first
-- try made and never makes a second; the same ID for another perp is refused. Only the listed
-- Bitcoin perp's settings are the founder's; a test perp may set its own, inside the same bounds.
create function admin.create_test_perp(
  perp uuid,
  name text,
  seed text,
  stand_in jsonb,
  settings jsonb,
  funding_from timestamptz,
  reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid := private.signed_in_admin();
  existing perps.perps;
begin
  if create_test_perp.perp is null or uuid_extract_version(create_test_perp.perp) is distinct from 7 then
    raise exception 'A perp''s ID is a version 7 UUID' using errcode = 'invalid_parameter_value';
  end if;
  -- Two tries of one request at once: the second waits here, then finds the first's perp.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin.create_test_perp:' || create_test_perp.perp::text, 0));
  select * into existing from perps.perps x where x.id = create_test_perp.perp;
  if found then
    if existing.created_by = who and existing.name = create_test_perp.name and not existing.listed then
      return perps.view(existing.id, true) || jsonb_build_object('log', perps.log_of(existing.id));
    end if;
    raise exception 'Perp ID % is already used for another perp', create_test_perp.perp
      using errcode = 'unique_violation';
  end if;
  if create_test_perp.seed is null or create_test_perp.seed !~ '^[0-9a-f]{16}$' then
    raise exception 'A test perp brings its own seed: 16 hexadecimal digits'
      using errcode = 'invalid_parameter_value';
  end if;
  if stand_in is null or jsonb_typeof(stand_in) <> 'object' or exists (
    select 1 from jsonb_object_keys(stand_in) k where k not in ('origin', 'startPrice', 'volatility')
  ) or stand_in ->> 'origin' is null or stand_in ->> 'startPrice' is null
    or stand_in ->> 'volatility' is null then
    raise exception 'A test perp''s price walk has its origin, start price and volatility'
      using errcode = 'invalid_parameter_value';
  end if;
  if (stand_in ->> 'origin')::timestamptz > clock_timestamp() then
    raise exception 'A test perp''s price walk starts no later than it''s made'
      using errcode = 'invalid_parameter_value';
  end if;
  if reason is null or char_length(btrim(reason)) = 0 then
    raise exception 'Every rule change says why' using errcode = 'invalid_parameter_value';
  end if;
  perform perps.create_perp(
    create_test_perp.perp, create_test_perp.name, false, create_test_perp.seed,
    (stand_in ->> 'origin')::timestamptz, (stand_in ->> 'startPrice')::numeric,
    (stand_in ->> 'volatility')::numeric, create_test_perp.settings,
    create_test_perp.funding_from, who, create_test_perp.reason);
  return perps.view(create_test_perp.perp, true)
         || jsonb_build_object('log', perps.log_of(create_test_perp.perp));
end;
$$;

-- Retires a check run's test perp once every position on it is closed: halted for good, and what its
-- pools hold (the house's subsidy, the fees, and whatever its traders lost) back to the house, so it
-- ends holding nothing. The listed perp is never retired.
create function admin.retire_test_perp(perp uuid, reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid := private.signed_in_admin();
  p perps.perps;
  retired timestamptz;
  house uuid := ledger.house();
  held_long numeric;
  held_short numeric;
begin
  select * into p from perps.perps x where x.id = retire_test_perp.perp for update;
  if not found then
    raise exception 'No such perp' using errcode = 'no_data_found';
  end if;
  if p.listed then
    raise exception 'The listed perp is never retired' using errcode = 'object_not_in_prerequisite_state';
  end if;
  if p.state <> 'live' then
    raise exception 'Perp % is already retired', p.id using errcode = 'object_not_in_prerequisite_state';
  end if;
  if exists (select 1 from perps.positions x where x.perp_id = p.id and x.closed_at is null) then
    raise exception 'Perp % still has an open position: every one closes first', p.id
      using errcode = 'object_not_in_prerequisite_state';
  end if;
  if reason is null or char_length(btrim(reason)) = 0 then
    raise exception 'Every rule change says why' using errcode = 'invalid_parameter_value';
  end if;
  retired := date_trunc('milliseconds', greatest(clock_timestamp(), p.updated_at));
  perform ledger.lock(array[house, p.long_account_id, p.short_account_id]);
  -- The perp's new state first: a retirement's moves fit only a retired perp (ledger.post_moves).
  update perps.perps x
  set state = 'retired', trading_mode = 'halted', retired_at = retired, updated_at = retired
  where x.id = p.id;
  select a.balance into held_long from ledger.accounts a where a.id = p.long_account_id;
  select a.balance into held_short from ledger.accounts a where a.id = p.short_account_id;
  if held_long > 0 or held_short > 0 then
    perform ledger.post_perp('perp_retire', p.id, 'A test perp''s pools back to the house', (
      select jsonb_agg(m) from (
        select jsonb_build_object('from', p.long_account_id, 'to', house, 'amount', held_long) as m
        where held_long > 0
        union all
        select jsonb_build_object('from', p.short_account_id, 'to', house, 'amount', held_short)
        where held_short > 0) x));
  end if;
  if p.trading_mode <> 'halted' then
    insert into perps.rule_changes (perp_id, at, by_account, rule, old_value, new_value, reason)
    values (p.id, retired, who, 'trading_mode', p.trading_mode, 'halted', reason);
  end if;
  insert into perps.rule_changes (perp_id, at, by_account, rule, old_value, new_value, reason)
  values (p.id, retired, who, 'retired', 'live', 'retired', reason);
  return perps.view(p.id, true) || jsonb_build_object('log', perps.log_of(p.id));
end;
$$;


-- 8. The Bitcoin perp -----------------------------------------------------------------------------------

-- Made once, here, on every environment (staging and, through the release pipeline, production),
-- switched off: production's stays off until launch. Its settings are Manifold's defaults with the
-- 10-times cap, as R3 set them (PERP_SETTINGS, product/packages/market-engine/src/perp/settings.ts);
-- its stand-in price walks from 1 January 2026 at $100,000, moving like Bitcoin (55% a year), from
-- the environment's own secret seed.
select perps.create_perp(
  '01a1c501-ec40-78f6-87b6-3fb041143421',
  'Bitcoin price (US dollars)',
  true,
  null,
  '2026-01-01 00:00:00+00',
  100000,
  0.55,
  jsonb_build_object(
    'maxLeverage', '10',
    'takerFeeBps', '10',
    'takerFeeImpact', '0',
    'fundingPeriodMs', '3600000',
    'fundingSensitivity', '1',
    'maxFundingRate', '0.00011415525114155251',
    'maxPriceAgeMs', '120000',
    'subsidyLong', '25000',
    'subsidyShort', '25000'),
  null,
  null,
  'The perp''s first settings: Manifold''s defaults with the 10-times cap (the founder''s decision, 10 November 2026)'
);


-- 9. Who may call what --------------------------------------------------------------------------------
-- Nothing in schema perps is open to anyone by default. The app's own role may run a step, read a
-- perp, the signed-in person's positions and the scheduled jobs' work, and call the console's
-- calls, which check the admins table themselves.

revoke all on all tables in schema perps from public, anon, authenticated, service_role, hrizzup_app;
revoke all on all sequences in schema perps from public, anon, authenticated, service_role, hrizzup_app;
revoke all on all functions in schema perps from public, anon, authenticated, service_role;
revoke all on function ledger.post_perp(text, uuid, text, jsonb) from public;
revoke all on function admin.perps(uuid, integer) from public, anon, authenticated, service_role;
revoke all on function admin.perp(uuid) from public, anon, authenticated, service_role;
revoke all on function admin.set_perp_mode(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function admin.set_perp_settings(uuid, jsonb, text) from public, anon, authenticated, service_role;
revoke all on function admin.create_test_perp(uuid, text, text, jsonb, jsonb, timestamptz, text)
  from public, anon, authenticated, service_role;
revoke all on function admin.retire_test_perp(uuid, text) from public, anon, authenticated, service_role;

grant usage on schema perps to hrizzup_app;
grant execute on function perps.holdings(uuid, uuid) to hrizzup_app;
grant execute on function perps.begin_step(uuid, text, uuid, jsonb, timestamptz) to hrizzup_app;
grant execute on function perps.apply_step(jsonb) to hrizzup_app;
grant execute on function perps.due(text) to hrizzup_app;
grant execute on function perps.details(uuid) to hrizzup_app;
grant execute on function perps.listed() to hrizzup_app;
grant execute on function perps.price_sources(uuid[]) to hrizzup_app;
grant execute on function perps.positions(uuid, integer) to hrizzup_app;
grant execute on function admin.perps(uuid, integer) to hrizzup_app;
grant execute on function admin.perp(uuid) to hrizzup_app;
grant execute on function admin.set_perp_mode(uuid, text, text) to hrizzup_app;
grant execute on function admin.set_perp_settings(uuid, jsonb, text) to hrizzup_app;
grant execute on function admin.create_test_perp(uuid, text, text, jsonb, jsonb, timestamptz, text)
  to hrizzup_app;
grant execute on function admin.retire_test_perp(uuid, text) to hrizzup_app;
