-- The markets' books (PLAN.md step 1.7b; blueprint section 5, "The markets' books"; the
-- founder's decisions of 9 November 2026). Database changes land first: nothing calls these
-- yet, and the tables stay empty until the code that uses them follows.
--
-- What this adds:
--   1. The app's own database role, hrizzup_app. It owns nothing, passes no row-level
--      security and may only call the functions granted to it at the end of this file. The
--      server's one database helper (@hrizzup/db) switches to it at the start of every
--      transaction and sets the signed-in account there, so the database itself knows who
--      is acting (auth.uid()).
--   2. The books (schema ledger): accounts (the house, each person, each market's pool),
--      entries, and moves. Every move of play money is stored once, out of one account and
--      into another, so its two lines (the view ledger.lines) always match and the books
--      always sum to zero. Moves and entries are never edited or deleted: a correction is a
--      new move. Each account's balance is kept beside it and always equals its lines. A
--      person's balance never goes below zero, except when a cancelled market takes back sale
--      profits; the balance then shows what's owed.
--   3. The markets (schema markets): each market's state, closing time and pool, every trade
--      with its fills, each person's position, and each trade request with its result, so a
--      retried request returns the first result and never trades twice. A market holds only
--      what trading needs; step 1.7c adds the agreement's market shape by additive changes.
--
-- The maths (prices, fills, limit orders) runs on the server (@hrizzup/market-engine, through
-- @hrizzup/ledger) inside the trade's transaction, with the time passed in. The database keeps
-- the books: it takes the market's lock, so trades on one market run strictly one after
-- another; it writes the trade, its fills, the positions, the pool and the moves together or
-- not at all; and it refuses anything that would break the books.
--
-- Amounts are exact decimals with six places (a millionth of a Ṁ), never floating point. The
-- engine's results are rounded once, on the server, always in the house's favour: what a
-- person receives (shares, sale proceeds, a settlement at a set probability) is rounded down,
-- and a person is never charged more than they asked or hold. What rounding leaves over stays
-- in the market's pool, which is the house's stake, and settlement pays the market's remainder
-- to the house account, so every market ends at exactly zero.

-- 1. The app's own role -----------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'hrizzup_app') then
    create role hrizzup_app nologin noinherit;
  end if;
end;
$$;
comment on role hrizzup_app is
  'The app''s own role: the server switches to it in every transaction (SET LOCAL ROLE). It owns '
  'nothing, passes no row-level security, and may only call the functions granted to it.';
-- The server logs in as postgres (Supabase's pooler) and switches to the app's role.
grant hrizzup_app to postgres;

-- 2. The books ----------------------------------------------------------------------------------

create schema ledger;
comment on schema ledger is
  'The play-money books: accounts, entries and moves. Reached only through its functions.';
revoke all on schema ledger from public;

create table ledger.accounts (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  user_id uuid references auth.users (id) on delete set null,
  balance numeric(20, 6) not null default 0,
  created_at timestamptz not null default now(),
  constraint accounts_kind check (kind in ('house', 'person', 'market')),
  constraint accounts_user_only_for_people check (kind = 'person' or user_id is null),
  constraint accounts_market_never_below_zero check (kind <> 'market' or balance >= 0)
);
comment on table ledger.accounts is
  'Every account of play money: the house (one; it gives out starting balances and seeds new '
  'markets, so its balance is minus everything given out), each person (by their sign-in '
  'account), and each market''s pool. The balance always equals the account''s lines.';
create unique index accounts_one_house on ledger.accounts (kind) where kind = 'house';
create unique index accounts_one_per_person on ledger.accounts (user_id) where kind = 'person';

create table ledger.entries (
  id bigint generated always as identity primary key,
  kind text not null,
  market_id uuid,
  memo text,
  created_at timestamptz not null default clock_timestamp(),
  constraint entries_kind check (
    kind in ('grant', 'seed', 'trade', 'settle', 'cancel', 'correction')
  ),
  constraint entries_market check (
    (kind in ('seed', 'trade', 'settle', 'cancel')) = (market_id is not null)
  ),
  constraint entries_memo_length check (char_length(memo) <= 500),
  constraint entries_correction_says_why check (kind <> 'correction' or memo is not null)
);
comment on table ledger.entries is
  'One event in the books (a starting balance, a market''s seed, a trade, a settlement, a '
  'cancel or a correction), holding its moves. Never edited or deleted.';
create index entries_market on ledger.entries (market_id) where market_id is not null;

create table ledger.moves (
  id bigint generated always as identity primary key,
  entry_id bigint not null references ledger.entries (id),
  from_account uuid not null references ledger.accounts (id),
  to_account uuid not null references ledger.accounts (id),
  amount numeric(20, 6) not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint moves_positive check (amount > 0),
  constraint moves_between_two_accounts check (from_account <> to_account)
);
comment on table ledger.moves is
  'Every move of play money, stored once: out of one account and into another, so its two '
  'lines always match (ledger.lines) and the books sum to zero. Never edited or deleted; a '
  'correction is a new move.';
create index moves_entry on ledger.moves (entry_id);
create index moves_from on ledger.moves (from_account);
create index moves_to on ledger.moves (to_account);

create view ledger.lines with (security_invoker = true) as
  select id as move_id, entry_id, from_account as account_id, -amount as amount, created_at
  from ledger.moves
  union all
  select id, entry_id, to_account, amount, created_at
  from ledger.moves;
comment on view ledger.lines is
  'The books as lines: each move is two matching lines, out of one account (negative) and '
  'into another (positive). They always sum to zero, and each account''s balance is its sum.';

-- The books never change: moves and entries are only ever added.
create function ledger.refuse_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'The books are never edited or deleted (%)', tg_table_name
    using errcode = 'restrict_violation',
          hint = 'A correction is a new move (ledger.correct).';
end;
$$;

create trigger moves_never_change
  before update or delete on ledger.moves
  for each row execute function ledger.refuse_change();
create trigger moves_never_truncated
  before truncate on ledger.moves
  for each statement execute function ledger.refuse_change();
create trigger entries_never_change
  before update or delete on ledger.entries
  for each row execute function ledger.refuse_change();
create trigger entries_never_truncated
  before truncate on ledger.entries
  for each statement execute function ledger.refuse_change();

-- An account starts at zero, is never deleted, and its balance changes only through its moves.
create function ledger.guard_account()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.balance <> 0 then
      raise exception 'An account starts at zero; money reaches it only through moves'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Accounts are never deleted' using errcode = 'restrict_violation';
  end if;
  if new.id <> old.id or new.kind <> old.kind or new.created_at <> old.created_at
     or (new.user_id is distinct from old.user_id and new.user_id is not null) then
    raise exception 'An account''s kind and owner never change' using errcode = 'restrict_violation';
  end if;
  if new.balance <> old.balance
     and coalesce(current_setting('ledger.posting', true), '') <> 'on' then
    raise exception 'A balance changes only through its moves' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger accounts_guard
  before insert or update or delete on ledger.accounts
  for each row execute function ledger.guard_account();
create trigger accounts_never_truncated
  before truncate on ledger.accounts
  for each statement execute function ledger.refuse_change();

-- 3. The markets --------------------------------------------------------------------------------

create schema markets;
comment on schema markets is
  'Play-money markets: their state and pools, trades, fills, positions and trade requests. '
  'Reached only through its functions.';
revoke all on schema markets from public;

create table markets.markets (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique references ledger.accounts (id),
  state text not null default 'open',
  closes_at timestamptz not null,
  p numeric(10, 8) not null,
  pool_yes numeric(20, 6) not null,
  pool_no numeric(20, 6) not null,
  seed numeric(20, 6) not null,
  trades integer not null default 0,
  last_trade_at timestamptz,
  price_tolerance numeric(12, 10) not null default 0.000001,
  resolution text,
  resolution_probability numeric(10, 8),
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint markets_state check (state in ('draft', 'open', 'closed', 'settled', 'cancelled')),
  constraint markets_p check (p > 0 and p < 1),
  constraint markets_pool check (pool_yes > 0 and pool_no > 0),
  constraint markets_seed check (seed > 0),
  constraint markets_trades check (trades >= 0),
  constraint markets_resolution check (resolution in ('YES', 'NO', 'MKT', 'CANCEL')),
  constraint markets_settled check (
    case state
      when 'settled' then resolution in ('YES', 'NO', 'MKT') and settled_at is not null
      when 'cancelled' then resolution = 'CANCEL' and settled_at is not null
      else resolution is null and settled_at is null
    end
  ),
  constraint markets_set_probability check (
    (resolution is distinct from 'MKT' and resolution_probability is null)
    or (resolution = 'MKT' and resolution_probability between 0 and 1)
  )
);
comment on table markets.markets is
  'A yes/no market: only what trading needs (its state, its closing time, and its pool, priced '
  'by Manifold''s maths: y^p * n^(1-p) = k). The money it holds sits in its own account. Step '
  '1.7c adds the agreement''s market shape (question, rules, source...) by additive changes.';
comment on column markets.markets.state is
  'The agreement''s five states: draft, open, closed, settled, cancelled. Trades need open, '
  'and a time before closes_at (checked inside each trade, never by a scheduled job).';
comment on column markets.markets.p is
  'The pool''s constant p, set once when the market opens (its starting probability).';
comment on column markets.markets.seed is
  'What the house put in to open the market (its starting pool: that many Yes and No shares).';
comment on column markets.markets.trades is
  'How many trades the market has run: each trade''s number, in the order they ran.';
comment on column markets.markets.price_tolerance is
  'How far the last trade''s rounding could move the price (most in a thin pool): the next trade '
  'allows a resting order that far past the price it starts from.';

alter table ledger.entries
  add constraint entries_market_fk foreign key (market_id) references markets.markets (id);

create table markets.requests (
  account_id uuid not null references ledger.accounts (id),
  id uuid not null,
  market_id uuid not null references markets.markets (id),
  action text not null,
  params jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (account_id, id),
  constraint requests_action check (action in ('buy', 'sell', 'cancel_order'))
);
comment on table markets.requests is
  'Each trade request, by the ID its sender chose, with its first result: a retry returns that '
  'result and never trades twice. A refusal is a result too. Never edited or deleted.';

create trigger requests_never_change
  before update or delete on markets.requests
  for each row execute function ledger.refuse_change();
create trigger requests_never_truncated
  before truncate on markets.requests
  for each statement execute function ledger.refuse_change();

create table markets.trades (
  id uuid primary key,
  market_id uuid not null references markets.markets (id),
  account_id uuid not null references ledger.accounts (id),
  request_id uuid,
  number integer not null,
  kind text not null,
  outcome text,
  order_amount numeric(20, 6),
  amount numeric(20, 6) not null default 0,
  shares numeric(20, 6) not null default 0,
  limit_prob numeric(10, 8),
  expires_at timestamptz,
  is_filled boolean not null default true,
  is_cancelled boolean not null default false,
  cancel_reason text,
  cancelled_at timestamptz,
  prob_before numeric(10, 8),
  prob_after numeric(10, 8),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint trades_request foreign key (account_id, request_id)
    references markets.requests (account_id, id) deferrable initially deferred,
  constraint trades_kind check (kind in ('buy', 'sell', 'redeem')),
  constraint trades_outcome check (
    (kind = 'redeem' and outcome is null) or (kind <> 'redeem' and outcome in ('YES', 'NO'))
  ),
  constraint trades_request_unless_redeem check ((kind = 'redeem') = (request_id is null)),
  constraint trades_limit check (
    limit_prob is null or (kind = 'buy' and limit_prob >= 0.01 and limit_prob <= 0.99)
  ),
  constraint trades_order_amount check (
    order_amount is null or (order_amount > 0 and amount <= order_amount)
  ),
  constraint trades_expiry_only_for_limits check (expires_at is null or limit_prob is not null),
  constraint trades_cancel_reason check (
    (is_cancelled and cancel_reason in ('by_owner', 'expired', 'no_balance', 'market_ended')
      and cancelled_at is not null)
    or (not is_cancelled and cancel_reason is null and cancelled_at is null)
  ),
  constraint trades_signs check (
    case kind
      when 'buy' then amount >= 0 and shares >= 0
      when 'sell' then amount <= 0 and shares <= 0
      else amount < 0 and shares > 0
    end
  )
);
comment on table markets.trades is
  'Every buy, sale and limit order, and each redemption (Yes and No held together cancel out, '
  'paying Ṁ1 a pair): what it paid (amount, negative when money came back) and the shares it '
  'got (negative when sold). A limit order rests, filling as later trades reach its price, '
  'until it is filled, cancelled or expired.';
comment on column markets.trades.number is
  'The number of the market''s trade it belongs to: trades ran in this order, one at a time.';
create index trades_open_orders on markets.trades (market_id, number)
  where limit_prob is not null and not is_filled and not is_cancelled;
create index trades_by_account on markets.trades (account_id, market_id);
create index trades_by_market on markets.trades (market_id, number);

create table markets.fills (
  id bigint generated always as identity primary key,
  trade_id uuid not null references markets.trades (id),
  matched_trade_id uuid references markets.trades (id),
  amount numeric(20, 6) not null,
  shares numeric(20, 6) not null,
  is_sale boolean not null default false,
  created_at timestamptz not null
);
comment on table markets.fills is
  'How each trade filled: against the pool (matched_trade_id is null) or against a resting '
  'order, which gets a matching fill of its own. Never edited or deleted.';
comment on column markets.fills.matched_trade_id is
  'The order this fill matched (or, on a resting order''s own fill, the trade that reached it).';
create index fills_by_trade on markets.fills (trade_id);

create trigger fills_never_change
  before update or delete on markets.fills
  for each row execute function ledger.refuse_change();
create trigger fills_never_truncated
  before truncate on markets.fills
  for each statement execute function ledger.refuse_change();

create table markets.positions (
  market_id uuid not null references markets.markets (id),
  account_id uuid not null references ledger.accounts (id),
  yes_shares numeric(20, 6) not null default 0,
  no_shares numeric(20, 6) not null default 0,
  updated_at timestamptz not null,
  primary key (market_id, account_id),
  constraint positions_not_negative check (yes_shares >= 0 and no_shares >= 0),
  constraint positions_yes_and_no_cancel_out check (yes_shares = 0 or no_shares = 0)
);
comment on table markets.positions is
  'The shares each person holds in each market. Yes and No held together cancel out (redeemed '
  'at Ṁ1 a pair), so at most one side is ever above zero. Kept as they were at settlement.';
create index positions_by_account on markets.positions (account_id);

-- Markets, trades and positions change as trading goes on, but are never emptied wholesale.
create trigger markets_never_truncated
  before truncate on markets.markets
  for each statement execute function ledger.refuse_change();
create trigger trades_never_truncated
  before truncate on markets.trades
  for each statement execute function ledger.refuse_change();
create trigger positions_never_truncated
  before truncate on markets.positions
  for each statement execute function ledger.refuse_change();

-- Every Yes share and every No share is backed by Ṁ1 in the market's account: while a market
-- trades, the money it holds equals its pool's Yes shares plus everyone's Yes shares, and the
-- same for No. Once settled or cancelled, it holds nothing. Checked when the transaction
-- commits, after every write to the market.
create function markets.check_backing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m markets.markets;
  held numeric;
  yes_held numeric;
  no_held numeric;
begin
  select * into m from markets.markets where id = new.id;
  select balance into held from ledger.accounts where id = m.account_id;
  if m.state in ('settled', 'cancelled') then
    if held <> 0 then
      raise exception 'Market % is % but still holds %', m.id, m.state, held
        using errcode = 'check_violation';
    end if;
    return null;
  end if;
  select coalesce(sum(yes_shares), 0), coalesce(sum(no_shares), 0)
    into yes_held, no_held
    from markets.positions where market_id = m.id;
  if held <> m.pool_yes + yes_held or held <> m.pool_no + no_held then
    raise exception 'Market % holds %, but its Yes shares come to % and its No shares to %',
      m.id, held, m.pool_yes + yes_held, m.pool_no + no_held
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

create constraint trigger markets_backed
  after insert or update on markets.markets
  deferrable initially deferred
  for each row execute function markets.check_backing();

-- 4. Posting moves --------------------------------------------------------------------------------

-- After every statement that adds moves: each move fits its entry (only these flows exist, and
-- a trade's, a settlement's or a cancel's only on a market in the matching state), the balances
-- change by exactly their lines, and no person is taken below zero, except by a cancelled market
-- taking back sale profits.
create function ledger.post_moves()
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

create trigger moves_post
  after insert on ledger.moves
  referencing new table as inserted
  for each statement execute function ledger.post_moves();

-- The house account, made the first time it's needed (so the tables start empty).
create function ledger.house()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  house uuid;
begin
  select id into house from ledger.accounts where kind = 'house';
  if house is null then
    insert into ledger.accounts (kind) values ('house')
    on conflict (kind) where kind = 'house' do nothing
    returning id into house;
    if house is null then
      select id into house from ledger.accounts where kind = 'house';
    end if;
  end if;
  return house;
end;
$$;

-- Adds an entry and all its moves in one statement. moves: [{"from", "to", "amount"}], amounts
-- as exact decimal text; moves of zero are left out. Returns the entry's ID.
create function ledger.post(kind text, market_id uuid, memo text, moves jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry bigint;
begin
  insert into ledger.entries (kind, market_id, memo)
  values (post.kind, post.market_id, post.memo)
  returning id into entry;
  insert into ledger.moves (entry_id, from_account, to_account, amount)
  select entry, (m ->> 'from')::uuid, (m ->> 'to')::uuid, (m ->> 'amount')::numeric(20, 6)
  from jsonb_array_elements(post.moves) as m
  where (m ->> 'amount')::numeric(20, 6) <> 0;
  return entry;
end;
$$;

-- Locks accounts in one fixed order (by ID), so two transactions never wait on each other.
create function ledger.lock(ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  select null from ledger.accounts where id = any (ids) order by id for update;
$$;

-- A person's account, with their starting balance from the house (step 3.1 decides the amount
-- and calls this at signup). For the owner only until then.
create function ledger.open_account(user_id uuid, starting numeric)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  account uuid;
  house uuid := ledger.house();
begin
  if starting is null or starting < 0 then
    raise exception 'A starting balance is zero or more' using errcode = 'invalid_parameter_value';
  end if;
  insert into ledger.accounts (kind, user_id) values ('person', open_account.user_id)
  returning id into account;
  if starting > 0 then
    perform ledger.lock(array[house, account]);
    perform ledger.post('grant', null, 'Starting balance',
      jsonb_build_array(jsonb_build_object('from', house, 'to', account, 'amount', starting)));
  end if;
  return account;
end;
$$;

-- More play money from the house to a person. For the owner only.
create function ledger.grant_money(account uuid, amount numeric, memo text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  house uuid := ledger.house();
begin
  if amount is null or amount <= 0 then
    raise exception 'A grant is more than zero' using errcode = 'invalid_parameter_value';
  end if;
  perform ledger.lock(array[house, account]);
  return ledger.post('grant', null, memo,
    jsonb_build_array(jsonb_build_object('from', house, 'to', account, 'amount', amount)));
end;
$$;

-- A correction: a new move between the house and a person, saying why. The books are never
-- edited, so this is how a mistake is put right. For the owner only.
create function ledger.correct(from_account uuid, to_account uuid, amount numeric, memo text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
begin
  if amount is null or amount <= 0 then
    raise exception 'A correction moves more than zero' using errcode = 'invalid_parameter_value';
  end if;
  perform ledger.lock(array[from_account, to_account]);
  return ledger.post('correction', null, memo,
    jsonb_build_array(jsonb_build_object('from', from_account, 'to', to_account, 'amount', amount)));
end;
$$;

-- Anything wrong with the books; must always be empty. The Database check runs it after every
-- step of its tests, and the Staging workflow on staging after every merge.
create function ledger.problems()
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
  where m.state in ('settled', 'cancelled') and a.balance <> 0;
$$;

-- 5. Markets: opening, trading, settling ------------------------------------------------------------

-- The probability a pool shows: p·n / ((1 − p)·y + p·n), Manifold's getCpmmProbability.
create function markets.probability(p numeric, pool_yes numeric, pool_no numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select round(p * pool_no / ((1 - p) * pool_yes + p * pool_no), 8);
$$;

-- Opens a test market: its pool account, seeded by the house with `seed` Ṁ, at the starting
-- probability. Step 1.7c replaces this with the console's create and open, for admins only.
create function markets.create_market(closes_at timestamptz, probability numeric, seed numeric)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  account uuid;
  market uuid;
  house uuid := ledger.house();
begin
  if probability is null or probability < 0.01 or probability > 0.99 then
    raise exception 'A market opens between 1%% and 99%%' using errcode = 'invalid_parameter_value';
  end if;
  if seed is null or seed <= 0 then
    raise exception 'A market''s seed is more than zero' using errcode = 'invalid_parameter_value';
  end if;
  insert into ledger.accounts (kind) values ('market') returning id into account;
  insert into markets.markets (account_id, state, closes_at, p, pool_yes, pool_no, seed)
  values (account, 'open', create_market.closes_at, probability, seed, seed, seed)
  returning id into market;
  perform ledger.lock(array[house, account]);
  perform ledger.post('seed', market, null,
    jsonb_build_array(jsonb_build_object('from', house, 'to', account, 'amount', seed)));
  return market;
end;
$$;

-- The start of a trade, inside its transaction: takes the market's lock (every trade on this
-- market waits here for the one before it), returns the stored result if this request was
-- already answered, and otherwise locks every account the trade can touch (in one fixed order)
-- and returns what the maths needs: the time, the market, the trader's balance and position,
-- every open order it can fill, in the order they were placed, and their owners' balances.
-- As in Manifold, that includes the trader's own orders: meeting one is a wash (the Yes and No
-- it gives cancel out at Ṁ1 a pair), and it keeps every resting order on the right side of the
-- pool's price, which Manifold's maths relies on.
--
-- Who is trading comes from the signed-in account (auth.uid()), which the server's database
-- helper sets. The time is always the database's own clock, read once the market's lock is
-- held and never earlier than the market's last trade; no caller can choose it.
create function markets.begin_trade(
  request_id uuid,
  market_id uuid,
  action text,
  params jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  signed_in uuid := auth.uid();
  trader uuid;
  m markets.markets;
  answered markets.requests;
  trade_at timestamptz;
  owners uuid[];
begin
  if signed_in is null then
    raise exception 'Trading needs a signed-in account' using errcode = 'insufficient_privilege';
  end if;
  if begin_trade.action is null or begin_trade.action not in ('buy', 'sell', 'cancel_order') then
    raise exception 'Unknown trade action %', begin_trade.action
      using errcode = 'invalid_parameter_value';
  end if;

  select * into m from markets.markets mk where mk.id = begin_trade.market_id for update;
  if not found then
    raise exception 'No such market' using errcode = 'no_data_found';
  end if;

  select a.id into trader from ledger.accounts a where a.kind = 'person' and a.user_id = signed_in;
  if trader is null then
    raise exception 'This account has no play money yet' using errcode = 'no_data_found';
  end if;

  select * into answered
  from markets.requests r
  where r.account_id = trader and r.id = begin_trade.request_id;
  if found then
    if answered.market_id <> m.id or answered.action <> begin_trade.action
       or answered.params <> begin_trade.params then
      raise exception 'This request ID was already used for a different request'
        using errcode = 'unique_violation';
    end if;
    return jsonb_build_object('replay', answered.result);
  end if;

  trade_at := date_trunc('milliseconds',
    greatest(clock_timestamp(), coalesce(m.last_trade_at, '-infinity')));
  -- apply_trade checks it follows this, in the same transaction, for this very request (the
  -- fingerprint of its action and parameters, so the plan can't swap in others).
  perform set_config('markets.trading',
    concat_ws('|', m.id, begin_trade.request_id, trader, trade_at,
              md5(begin_trade.action || ':' || begin_trade.params::text)),
    true);

  select coalesce(array_agg(distinct t.account_id), '{}') into owners
  from markets.trades t
  where t.market_id = m.id
    and t.limit_prob is not null and not t.is_filled and not t.is_cancelled
    and (t.expires_at is null or t.expires_at > trade_at);
  perform ledger.lock(owners || trader || m.account_id);

  return jsonb_build_object(
    'now', trade_at,
    'market', jsonb_build_object(
      'id', m.id,
      'state', m.state,
      'closes_at', m.closes_at,
      'p', m.p::text,
      'pool_yes', m.pool_yes::text,
      'pool_no', m.pool_no::text,
      'seed', m.seed::text
    ),
    'account', (
      select jsonb_build_object('id', a.id, 'balance', a.balance::text)
      from ledger.accounts a where a.id = trader
    ),
    'position', coalesce((
      select jsonb_build_object('yes', p.yes_shares::text, 'no', p.no_shares::text)
      from markets.positions p where p.market_id = m.id and p.account_id = trader
    ), jsonb_build_object('yes', '0', 'no', '0')),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'account_id', t.account_id,
        'outcome', t.outcome,
        'order_amount', t.order_amount::text,
        'amount', t.amount::text,
        'shares', t.shares::text,
        'limit_prob', t.limit_prob::text,
        'expires_at', t.expires_at,
        'created_at', t.created_at
      ) order by t.number)
      from markets.trades t
      where t.market_id = m.id
        and t.limit_prob is not null and not t.is_filled and not t.is_cancelled
        and (t.expires_at is null or t.expires_at > trade_at)
    ), '[]'::jsonb),
    'balances', coalesce((
      select jsonb_object_agg(a.id, a.balance::text)
      from ledger.accounts a where a.id = any (owners)
    ), '{}'::jsonb)
  );
end;
$$;

-- The rest of a trade, after the server has run the maths on what begin_trade returned:
-- writes the trade, its fills, the resting orders it filled, the positions (Yes and No held
-- together cancel out), the moves and the pool, together, then stores the request's result.
-- A refusal is stored as the result instead, with nothing else written.
--
-- plan: {
--   "request_id", "market_id", "action": "buy" | "sell" | "cancel_order", "params",
--   "refusal": a reason (nothing is traded), or absent,
--   "order_id": the order to cancel (cancel_order),
--   "trade": {"id", "outcome", "order_amount", "limit_prob", "expires_at", "is_filled"},
--   "fills": [{"matched": an order's ID, or null for the pool, "amount", "shares"}],
--   "makers": [{"order_id", "amount", "shares"}],
--   "cancel": [the IDs of orders whose owners ran out of money],
--   "pool": {"yes", "no"}: the pool the maths ended with, rounded
-- }
-- Amounts and shares are exact decimal text, rounded once on the server.
--
-- The database doesn't take the plan on trust. It refuses one that doesn't match the request
-- begin_trade started; whose fills have the wrong signs, or name orders it doesn't fill, or
-- name one twice; where a resting order pays anything but its own limit price, or is filled
-- though the trade's price never reached it; that takes the price past the trade's own limit;
-- or that moves the pool off Manifold's curve (y^p · n^(1−p) stays the same in every trade, up
-- to the rounding). The pool is worked out here from the money the market holds and everyone's
-- shares, so every share stays backed exactly, and must also agree with the maths' pool to
-- within Ṁ0.001. Orders are cancelled for lack of money only where the database itself sees
-- their owners can't pay, or the price has passed them unfilled.
create function markets.apply_trade(plan jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  marker text[] := string_to_array(current_setting('markets.trading', true), '|');
  request uuid := (plan ->> 'request_id')::uuid;
  market uuid := (plan ->> 'market_id')::uuid;
  kind text := plan ->> 'action';
  asking jsonb := plan -> 'params';
  trader uuid;
  trade_at timestamptz;
  m markets.markets;
  trade uuid;
  trade_number integer;
  trade_outcome text;
  paid numeric;
  got numeric;
  asked numeric;
  limit_at numeric;
  expiry timestamptz;
  done boolean;
  rising boolean;
  before_prob numeric;
  after_prob numeric;
  maker record;
  filled record;
  touched record;
  price numeric;
  limits numeric[] := '{}';
  makers_seen integer := 0;
  slack_side numeric;
  tolerance numeric;
  tolerance_before numeric;
  start_balances jsonb;
  paid_by jsonb := '{}'::jsonb;
  passed record;
  changes jsonb := '[]'::jsonb;
  moves jsonb := '[]'::jsonb;
  pairs numeric;
  held numeric;
  yes_held numeric;
  no_held numeric;
  new_yes numeric;
  new_no numeric;
  k_before numeric;
  k_after numeric;
  slack numeric;
  outcome_status text;
  result jsonb;
begin
  if marker is null or cardinality(marker) <> 5
     or marker[1] <> market::text or marker[2] <> request::text then
    raise exception 'A trade is applied only after begin_trade, in the same transaction'
      using errcode = 'invalid_transaction_state';
  end if;
  if md5(kind || ':' || asking::text) is distinct from marker[5] then
    raise exception 'The trade''s request is not the one begin_trade started'
      using errcode = 'invalid_transaction_state';
  end if;
  trader := marker[3]::uuid;
  trade_at := marker[4]::timestamptz;
  select * into m from markets.markets mk where mk.id = market for update;

  -- A refusal: nothing is traded, and the refusal is the request's result.
  if plan ->> 'refusal' is not null then
    result := jsonb_build_object(
      'status', 'refused', 'reason', plan ->> 'refusal', 'request_id', request, 'market_id', market);
    insert into markets.requests (account_id, id, market_id, action, params, result)
    values (trader, request, market, kind, asking, result);
    return result;
  end if;

  -- Cancelling one of your own resting orders: no money moves.
  if kind = 'cancel_order' then
    update markets.trades t
    set is_cancelled = true, cancel_reason = 'by_owner', cancelled_at = trade_at,
        updated_at = trade_at
    where t.id = (asking ->> 'orderId')::uuid
      and t.market_id = market and t.account_id = trader
      and t.limit_prob is not null and not t.is_filled and not t.is_cancelled
      and (t.expires_at is null or t.expires_at > trade_at);
    if found then
      result := jsonb_build_object(
        'status', 'cancelled', 'request_id', request, 'market_id', market,
        'order_id', asking ->> 'orderId');
    else
      result := jsonb_build_object(
        'status', 'refused', 'reason', 'no_open_order', 'request_id', request,
        'market_id', market);
    end if;
    insert into markets.requests (account_id, id, market_id, action, params, result)
    values (trader, request, market, kind, asking, result);
    return result;
  end if;

  if kind is null or kind not in ('buy', 'sell') then
    raise exception 'Unknown trade action %', kind using errcode = 'invalid_parameter_value';
  end if;
  if m.state <> 'open' or trade_at >= m.closes_at then
    raise exception 'Market % is not open for trading', market using errcode = 'check_violation';
  end if;

  trade_number := m.trades + 1;
  trade := (plan -> 'trade' ->> 'id')::uuid;
  trade_outcome := plan -> 'trade' ->> 'outcome';
  asked := (plan -> 'trade' ->> 'order_amount')::numeric(20, 6);
  limit_at := (plan -> 'trade' ->> 'limit_prob')::numeric(10, 8);
  expiry := (plan -> 'trade' ->> 'expires_at')::timestamptz;
  select coalesce(sum((f ->> 'amount')::numeric(20, 6)), 0),
         coalesce(sum((f ->> 'shares')::numeric(20, 6)), 0)
    into paid, got
    from jsonb_array_elements(plan -> 'fills') f;
  -- A limit order with nothing left of it is filled, whatever the maths' own flag says.
  done := coalesce((plan -> 'trade' ->> 'is_filled')::boolean, true) or limit_at is null
          or asked - paid <= 0.000001;
  before_prob := markets.probability(m.p, m.pool_yes, m.pool_no);
  -- Buying Yes, or selling No (which buys Yes), moves the price up; the others move it down.
  rising := (kind = 'buy') = (trade_outcome = 'YES');

  -- The plan matches the request, and its fills have the request's signs.
  if trade_outcome is null or trade_outcome not in ('YES', 'NO')
     or trade_outcome is distinct from asking ->> 'outcome'
     or (kind = 'buy' and (
           asked is distinct from (asking ->> 'amount')::numeric(20, 6)
           or limit_at is distinct from (asking ->> 'limitProb')::numeric(10, 8)
           or expiry is distinct from (asking ->> 'expiresAt')::timestamptz))
     or (kind = 'sell' and (asked is not null or limit_at is not null or expiry is not null
                            or -got > coalesce((asking ->> 'shares')::numeric(20, 6), -1)))
     or exists (
           select 1 from jsonb_array_elements(plan -> 'fills') f
           where case kind
                   when 'buy' then (f ->> 'amount')::numeric < 0 or (f ->> 'shares')::numeric < 0
                   else (f ->> 'amount')::numeric > 0 or (f ->> 'shares')::numeric > 0
                 end)
     or exists (
           select 1 from jsonb_array_elements(plan -> 'makers') x
           where (x ->> 'amount')::numeric <= 0 or (x ->> 'shares')::numeric < 0) then
    raise exception 'The trade does not match its request' using errcode = 'check_violation';
  end if;
  -- Each order the trade filled appears once, no more.
  if (select count(*) <> count(distinct x ->> 'order_id') from jsonb_array_elements(plan -> 'makers') x)
     or (select count(*) <> count(distinct f ->> 'matched')
         from jsonb_array_elements(plan -> 'fills') f where f ->> 'matched' is not null) then
    raise exception 'The trade names an order more than once' using errcode = 'check_violation';
  end if;
  -- Each resting order the trade filled appears once among its fills, and nowhere else.
  if (select coalesce(array_agg(f ->> 'matched' order by f ->> 'matched'), '{}')
      from jsonb_array_elements(plan -> 'fills') f where f ->> 'matched' is not null)
     is distinct from
     (select coalesce(array_agg(x ->> 'order_id' order by x ->> 'order_id'), '{}')
      from jsonb_array_elements(plan -> 'makers') x) then
    raise exception 'The trade''s fills and the orders it filled do not agree'
      using errcode = 'check_violation';
  end if;

  insert into markets.trades (
    id, market_id, account_id, request_id, number, kind, outcome, order_amount, amount, shares,
    limit_prob, expires_at, is_filled, prob_before, created_at, updated_at)
  values (
    trade, market, trader, request, trade_number, kind, trade_outcome,
    case when kind = 'buy' then asked end, paid, got,
    limit_at, expiry, done, before_prob, trade_at, trade_at);

  insert into markets.fills (trade_id, matched_trade_id, amount, shares, is_sale, created_at)
  select trade, (f ->> 'matched')::uuid, (f ->> 'amount')::numeric(20, 6),
         (f ->> 'shares')::numeric(20, 6), kind = 'sell', trade_at
  from jsonb_array_elements(plan -> 'fills') f;

  -- What each account's shares change by, and the money each pays or gets: the trader's first,
  -- then each resting order's owner's.
  changes := changes || jsonb_build_object(
    'account_id', trader,
    'yes_change', case when trade_outcome = 'YES' then got else 0 end,
    'no_change', case when trade_outcome = 'NO' then got else 0 end);
  if paid > 0 then
    moves := moves || jsonb_build_object('from', trader, 'to', m.account_id, 'amount', paid);
  elsif paid < 0 then
    moves := moves || jsonb_build_object('from', m.account_id, 'to', trader, 'amount', -paid);
  end if;

  for maker in
    select (x ->> 'order_id')::uuid as order_id,
           (x ->> 'amount')::numeric(20, 6) as amount,
           (x ->> 'shares')::numeric(20, 6) as shares
    from jsonb_array_elements(plan -> 'makers') x
  loop
    update markets.trades t
    set amount = t.amount + maker.amount,
        shares = t.shares + maker.shares,
        is_filled = t.order_amount - (t.amount + maker.amount) <= 0.000001,
        updated_at = trade_at
    where t.id = maker.order_id
      and t.market_id = market
      and t.limit_prob is not null and not t.is_filled and not t.is_cancelled
      and (t.expires_at is null or t.expires_at > trade_at)
    returning t.account_id, t.outcome, t.limit_prob into filled;
    if not found then
      raise exception 'Order % is not an open order this trade can fill', maker.order_id
        using errcode = 'check_violation';
    end if;
    -- A resting order is filled from the other side (a sale buys the side it sells), at
    -- exactly its own limit price, rounded once.
    price := case when filled.outcome = 'YES' then filled.limit_prob else 1 - filled.limit_prob end;
    if (filled.outcome = trade_outcome) <> (kind = 'sell')
       or abs(maker.amount - maker.shares * price) > 0.000003 then
      raise exception 'Order % is not filled at its limit price', maker.order_id
        using errcode = 'check_violation';
    end if;
    limits := limits || filled.limit_prob;
    makers_seen := makers_seen + 1;
    paid_by := jsonb_set(paid_by, array[filled.account_id::text],
      to_jsonb(coalesce((paid_by ->> filled.account_id::text)::numeric, 0) + maker.amount));
    insert into markets.fills (trade_id, matched_trade_id, amount, shares, created_at)
    values (maker.order_id, trade, maker.amount, maker.shares, trade_at);
    changes := changes || jsonb_build_object(
      'account_id', filled.account_id,
      'yes_change', case when filled.outcome = 'YES' then maker.shares else 0 end,
      'no_change', case when filled.outcome = 'NO' then maker.shares else 0 end);
    if maker.amount > 0 then
      moves := moves || jsonb_build_object(
        'from', filled.account_id, 'to', m.account_id, 'amount', maker.amount);
    end if;
  end loop;

  -- The new positions. Yes and No held together cancel out: each pair is redeemed for Ṁ1.
  for touched in
    select c.account_id,
           coalesce(p.yes_shares, 0) + sum(c.yes_change) as yes_after,
           coalesce(p.no_shares, 0) + sum(c.no_change) as no_after
    from jsonb_to_recordset(changes) as c (account_id uuid, yes_change numeric, no_change numeric)
    left join markets.positions p on p.market_id = market and p.account_id = c.account_id
    group by c.account_id, p.yes_shares, p.no_shares
    having sum(c.yes_change) <> 0 or sum(c.no_change) <> 0
  loop
    if touched.yes_after < 0 or touched.no_after < 0 then
      raise exception 'Not enough shares to sell' using errcode = 'check_violation';
    end if;
    pairs := least(touched.yes_after, touched.no_after);
    if pairs > 0 then
      insert into markets.trades (
        id, market_id, account_id, number, kind, amount, shares, prob_before, created_at,
        updated_at)
      values (
        gen_random_uuid(), market, touched.account_id, trade_number, 'redeem', -pairs, pairs,
        before_prob, trade_at, trade_at);
      moves := moves || jsonb_build_object(
        'from', m.account_id, 'to', touched.account_id, 'amount', pairs);
    end if;
    insert into markets.positions as p (market_id, account_id, yes_shares, no_shares, updated_at)
    values (market, touched.account_id, touched.yes_after - pairs, touched.no_after - pairs,
            trade_at)
    on conflict (market_id, account_id) do update
      set yes_shares = excluded.yes_shares, no_shares = excluded.no_shares,
          updated_at = excluded.updated_at;
  end loop;

  -- Orders that have expired.
  update markets.trades t
  set is_cancelled = true, cancel_reason = 'expired', cancelled_at = trade_at,
      updated_at = trade_at
  where t.market_id = market
    and t.limit_prob is not null and not t.is_filled and not t.is_cancelled
    and t.expires_at <= trade_at;

  -- Every open order's owner's balance as the trade starts, before any move is posted: what
  -- the maths could see they had.
  select coalesce(jsonb_object_agg(a.id, a.balance), '{}'::jsonb) into start_balances
  from ledger.accounts a
  where a.id in (
    select t.account_id from markets.trades t
    where t.market_id = market
      and t.limit_prob is not null and not t.is_filled and not t.is_cancelled);

  if jsonb_array_length(moves) > 0 then
    perform ledger.post('trade', market, null, moves);
  end if;

  -- The pool: the money the market holds, less everyone's shares, on each side.
  select a.balance into held from ledger.accounts a where a.id = m.account_id;
  select coalesce(sum(p.yes_shares), 0), coalesce(sum(p.no_shares), 0)
    into yes_held, no_held
    from markets.positions p where p.market_id = market;
  new_yes := held - yes_held;
  new_no := held - no_held;
  if new_yes <= 0 or new_no <= 0
     or abs(new_yes - (plan -> 'pool' ->> 'yes')::numeric) > 0.001
     or abs(new_no - (plan -> 'pool' ->> 'no')::numeric) > 0.001 then
    raise exception 'The trade does not add up: the pool would hold % Yes and % No, but the maths says % and %',
      new_yes, new_no, plan -> 'pool' ->> 'yes', plan -> 'pool' ->> 'no'
      using errcode = 'check_violation';
  end if;
  -- The pool stays on Manifold's curve: y^p · n^(1−p) is the same after every trade, up to the
  -- rounding: allowed, Ṁ0.00001 on each side and Ṁ0.000004 more for each order filled, never
  -- more than Ṁ0.001 however many orders the plan names.
  slack_side := least(0.00001 + 0.000004 * makers_seen, 0.001);
  k_before := exp(m.p * ln(m.pool_yes) + (1 - m.p) * ln(m.pool_no));
  k_after := exp(m.p * ln(new_yes) + (1 - m.p) * ln(new_no));
  slack := k_before * slack_side * (m.p / new_yes + (1 - m.p) / new_no);
  if abs(k_after - k_before) > slack + 0.000000001 then
    raise exception 'The trade moves the pool off its curve (from % to %)', k_before, k_after
      using errcode = 'check_violation';
  end if;
  after_prob := markets.probability(m.p, new_yes, new_no);
  -- How far that rounding can move the price (most in a thin pool): prob(1 − prob)·δ·(1/y + 1/n).
  tolerance := 0.000001 + 0.25 * slack_side * (1 / new_yes + 1 / new_no);
  -- The trade before may have left an order a hair past the price it ended at, by as much as
  -- its own rounding could move the price, which it kept on the market.
  tolerance_before := greatest(m.price_tolerance, 0.000001);
  -- A resting order fills only once the price reaches it: its limit lies on the trade's path.
  if exists (
       select 1 from unnest(limits) l
       where case when rising
                  then l < before_prob - tolerance_before or l > after_prob + tolerance
                  else l > before_prob + tolerance_before or l < after_prob - tolerance
             end) then
    raise exception 'The trade fills an order its price never reached'
      using errcode = 'check_violation';
  end if;
  -- A limit order never takes the price past its own limit (a Yes order buys only while Yes is
  -- below its limit, a No order only while Yes is above it); one that rests leaves the price
  -- where it was.
  if limit_at is not null
     and (case when rising then after_prob > greatest(before_prob, limit_at) + tolerance
               else after_prob < least(before_prob, limit_at) - tolerance end) then
    raise exception 'The trade goes past its own limit' using errcode = 'check_violation';
  end if;
  -- An order the price has now passed without filling it: only an owner who couldn't pay lets
  -- that happen (as the maths saw it: their balance as the trade started, less what their
  -- other orders paid in it). Otherwise the trade skipped an order it should have filled.
  for passed in
    select t.id, t.account_id
    from markets.trades t
    where t.market_id = market
      and t.limit_prob is not null and not t.is_filled and not t.is_cancelled
      and (t.expires_at is null or t.expires_at > trade_at)
      and case when t.outcome = 'YES'
               then after_prob < t.limit_prob - greatest(tolerance, tolerance_before)
               else after_prob > t.limit_prob + greatest(tolerance, tolerance_before) end
  loop
    if coalesce((start_balances ->> passed.account_id::text)::numeric, 0)
       - coalesce((paid_by ->> passed.account_id::text)::numeric, 0) > 0.000001 then
      raise exception 'The trade passes order % without filling it, though its owner can pay',
        passed.id using errcode = 'check_violation';
    end if;
  end loop;
  -- Orders that can't be filled any more, cancelled: those the price has passed, and those the
  -- maths stopped at because their owners ran out of money, where the database agrees they
  -- had nothing left to pay with.
  update markets.trades t
  set is_cancelled = true, cancel_reason = 'no_balance', cancelled_at = trade_at,
      updated_at = trade_at
  where t.market_id = market
    and t.limit_prob is not null and not t.is_filled and not t.is_cancelled
    and ((case when t.outcome = 'YES'
               then after_prob < t.limit_prob - greatest(tolerance, tolerance_before)
               else after_prob > t.limit_prob + greatest(tolerance, tolerance_before) end)
         or (t.id in (select (c #>> '{}')::uuid from jsonb_array_elements(plan -> 'cancel') c)
             and coalesce((start_balances ->> t.account_id::text)::numeric, 0)
                 - coalesce((paid_by ->> t.account_id::text)::numeric, 0) <= 0.000001));

  -- The allowance the next trade starts from: this trade's own, or, if it left the price where
  -- it was, also whatever the trade before allowed (an order it left a hair past is still there).
  update markets.markets mk
  set pool_yes = new_yes, pool_no = new_no, trades = trade_number, last_trade_at = trade_at,
      price_tolerance = least(
        case when new_yes = m.pool_yes and new_no = m.pool_no
             then greatest(tolerance, tolerance_before) else tolerance end,
        0.01),
      updated_at = trade_at
  where mk.id = market;
  update markets.trades t set prob_after = after_prob
  where t.market_id = market and t.number = trade_number;

  select t.amount, t.shares, t.is_filled into paid, got, done
  from markets.trades t where t.id = trade;
  outcome_status := case
    when kind = 'sell' or done then 'filled'
    when paid = 0 then 'resting'
    else 'partly_filled'
  end;
  result := jsonb_build_object(
    'status', outcome_status,
    'request_id', request,
    'market_id', market,
    'trade_id', trade,
    'number', trade_number,
    'outcome', trade_outcome,
    'amount', paid::text,
    'shares', got::text,
    'order_amount', asked::text,
    'limit_prob', limit_at::text,
    'prob_before', before_prob::text,
    'prob_after', after_prob::text,
    'balance', (select a.balance::text from ledger.accounts a where a.id = trader),
    'position', coalesce((
      select jsonb_build_object('yes', p.yes_shares::text, 'no', p.no_shares::text)
      from markets.positions p where p.market_id = market and p.account_id = trader
    ), jsonb_build_object('yes', '0', 'no', '0')),
    'at', trade_at
  );
  insert into markets.requests (account_id, id, market_id, action, params, result)
  values (trader, request, market, kind, asking, result);
  return result;
end;
$$;

-- Settles a market, in one transaction: Yes or No pays Ṁ1 for each winning share; a set
-- probability (MKT) pays each Yes share that and each No share the rest, rounded down to a
-- millionth; a cancel gives each person back what they put in, less what they took out, which
-- takes back sale profits (the balance can then go below zero, showing what's owed). The house
-- gets whatever is left, so the market ends at exactly zero. Resting orders are cancelled. For
-- the owner only until step 1.7c, which checks the admins table and logs every settlement.
create function markets.settle(market_id uuid, resolution text, probability numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m markets.markets;
  settled_time timestamptz := date_trunc('milliseconds', clock_timestamp());
  house uuid := ledger.house();
  entry bigint;
  held numeric;
  paid numeric;
  people integer;
begin
  if settle.resolution is null or settle.resolution not in ('YES', 'NO', 'MKT', 'CANCEL') then
    raise exception 'A market settles YES, NO, MKT or CANCEL' using errcode = 'invalid_parameter_value';
  end if;
  if (settle.resolution = 'MKT') <> (settle.probability is not null)
     or settle.probability < 0 or settle.probability > 1 then
    raise exception 'MKT, and only MKT, takes a probability between 0 and 1'
      using errcode = 'invalid_parameter_value';
  end if;

  select * into m from markets.markets mk where mk.id = settle.market_id for update;
  if not found then
    raise exception 'No such market' using errcode = 'no_data_found';
  end if;
  if m.state not in ('open', 'closed') then
    raise exception 'Market % is already %', m.id, m.state using errcode = 'check_violation';
  end if;

  perform ledger.lock(array(
    select p.account_id from markets.positions p where p.market_id = m.id
    union
    select l.account_id
    from ledger.lines l join ledger.entries e on e.id = l.entry_id
    where e.market_id = m.id
    union select m.account_id
    union select house));

  update markets.trades t
  set is_cancelled = true, cancel_reason = 'market_ended', cancelled_at = settled_time,
      updated_at = settled_time
  where t.market_id = m.id and t.limit_prob is not null and not t.is_filled and not t.is_cancelled;

  -- The market's new state first: a settlement's moves fit only a settled market, and a
  -- cancel's (the only moves that can take a person below zero) only a cancelled one.
  update markets.markets mk
  set state = case when settle.resolution = 'CANCEL' then 'cancelled' else 'settled' end,
      resolution = settle.resolution,
      resolution_probability = settle.probability,
      settled_at = settled_time,
      updated_at = settled_time
  where mk.id = m.id;

  insert into ledger.entries (kind, market_id, memo)
  values (
    case when settle.resolution = 'CANCEL' then 'cancel' else 'settle' end,
    m.id,
    case when settle.resolution = 'MKT' then format('MKT at %s', settle.probability)
         else settle.resolution end)
  returning id into entry;
  select a.balance into held from ledger.accounts a where a.id = m.account_id;

  -- What each person gets (or, in a cancel, pays back), the house the rest, in one statement.
  with payouts as (
    select l.account_id, -sum(l.amount) as amount
    from ledger.lines l
    join ledger.entries e on e.id = l.entry_id
    join ledger.accounts a on a.id = l.account_id
    where settle.resolution = 'CANCEL' and e.market_id = m.id and a.kind = 'person'
    group by l.account_id
    union all
    select p.account_id,
           case settle.resolution
             when 'YES' then p.yes_shares
             when 'NO' then p.no_shares
             else trunc(settle.probability * p.yes_shares
                        + (1 - settle.probability) * p.no_shares, 6)
           end
    from markets.positions p
    where settle.resolution <> 'CANCEL' and p.market_id = m.id
  ),
  totals as (
    select coalesce(sum(amount), 0) as paid_out, count(*) filter (where amount <> 0) as paid_to
    from payouts
  ),
  posted as (
    insert into ledger.moves (entry_id, from_account, to_account, amount)
    select entry,
           case when x.amount > 0 then m.account_id else x.account_id end,
           case when x.amount > 0 then x.account_id else m.account_id end,
           abs(x.amount)
    from (
      select payouts.account_id, payouts.amount from payouts
      union all
      select house, held - totals.paid_out from totals
    ) x
    where x.amount <> 0
    returning 1
  )
  select totals.paid_out, totals.paid_to into paid, people from totals;

  return jsonb_build_object(
    'market_id', m.id,
    'resolution', settle.resolution,
    'probability', settle.probability::text,
    'paid_to_people', paid::text,
    'people', people,
    'to_house', (held - paid)::text,
    'at', settled_time
  );
end;
$$;

-- 6. Who may call what ---------------------------------------------------------------------------
-- Nothing in these schemas is open to anyone by default. The app's role may only start and
-- apply a trade, as the signed-in account; opening accounts, granting, correcting, opening
-- markets and settling stay with the owner until the steps that need them (3.1, 1.7c) grant
-- them, with their own checks.

revoke all on all tables in schema ledger, markets from public;
revoke all on all sequences in schema ledger, markets from public;
revoke all on all functions in schema ledger, markets from public;
grant usage on schema markets to hrizzup_app;
grant execute on function markets.begin_trade(uuid, uuid, text, jsonb) to hrizzup_app;
grant execute on function markets.apply_trade(jsonb) to hrizzup_app;
