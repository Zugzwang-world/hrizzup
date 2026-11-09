-- The typed API's trading reads (PLAN.md step 1.7d; blueprint sections 5 and 13; the founder's
-- decisions of 9 November 2026). Database changes land first: nothing calls these yet. The typed
-- API's calls (the market list, trade, cancel, positions and open orders) follow in the next pull
-- request.
--
-- What this adds, in a schema of its own (trading), beside the console's (admin):
--   1. trading.markets(after_market, max_count): the markets anyone may see, newest first, a page at
--      a time, each as the agreement's market record (market/1) with the probability its pool shows
--      while it's open or closed. Never a draft, which is still being prepared, nor a market settled
--      at a set probability, which the agreement's market shape can't describe yet (the Product
--      brief's open questions). It reads nothing about whoever asks, so its answer may be kept at
--      the edge and shared.
--   2. trading.holdings(market): the signed-in person's balance and their shares in one market, with
--      the market's state and closing time: what the trade call checks before it touches the books,
--      so an amount over the balance, shares over what's held, or a market that isn't open is
--      refused without a lock taken or a line written.
--   3. trading.positions(after_market, max_count): the signed-in person's balance and their positions
--      in markets still open or waiting to be settled, newest market first, a page at a time.
--   4. trading.orders(after_order, max_count): the signed-in person's resting limit orders (not filled,
--      cancelled or expired), newest first, a page at a time; and an index that finds them.
--
-- Each of the person's reads names no one else's money: it reads the signed-in account
-- (auth.uid(), which the server's database helper sets) and refuses when nobody is. The app's own
-- role may call these four and nothing else new; trades still go only through markets.begin_trade
-- and markets.apply_trade (step 1.7b), which check everything again under the market's lock.


create schema trading;
comment on schema trading is
  'The typed API''s trading reads (PLAN.md step 1.7d): the markets anyone may see, and a signed-in '
  'person''s own holdings, positions and open orders. Reached only through its functions, which the '
  'app''s own role may call. Trades go through markets.begin_trade and markets.apply_trade.';
revoke all on schema trading from public;


-- 1. The markets anyone may see -------------------------------------------------------------------

-- Newest first (their IDs are version 7 UUIDs, which sort by when they were made), up to `max_count`
-- at a time; `after_market` is the last market of the page before. Answers
-- {"markets": [{"market": a market/1 record, "probability": text, or null once settled}, ...],
--  "next": the ID to ask after for the next page, or null}.
create function trading.markets(after_market uuid, max_count integer)
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


-- 2. What the signed-in person holds in one market --------------------------------------------------

-- Their balance (zero while they have no play money yet) and their Yes and No shares in `market`,
-- with the market's state and closing time; null when there's no such market. Read before a trade,
-- outside its transaction: the trade checks all of it again under the market's lock.
create function trading.holdings(market uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  who uuid := auth.uid();
begin
  if who is null then
    raise exception 'Holdings are read for a signed-in account' using errcode = 'insufficient_privilege';
  end if;
  return (
    select jsonb_build_object(
      'market_id', m.id,
      'state', m.state,
      'closes_at', markets.utc(m.closes_at),
      'has_account', a.id is not null,
      'balance', coalesce(a.balance, 0)::numeric(20, 6)::text,
      'yes', coalesce(p.yes_shares, 0)::numeric(20, 6)::text,
      'no', coalesce(p.no_shares, 0)::numeric(20, 6)::text
    )
    from markets.markets m
    left join ledger.accounts a on a.kind = 'person' and a.user_id = who
    left join markets.positions p on p.market_id = m.id and p.account_id = a.id
    where m.id = holdings.market
  );
end;
$$;


-- 3. The signed-in person's positions ----------------------------------------------------------------

-- Their balance, and their shares in each market still open or waiting to be settled (closed), newest
-- market first, up to `max_count` at a time; `after_market` is the last market of the page before.
-- A settled or cancelled market has paid out, so its position is no longer one. Answers
-- {"balance": text, "positions": [{"market_id", "question", "state", "closes_at", "yes", "no",
--  "probability"}, ...], "next": the market ID to ask after for the next page, or null}.
create function trading.positions(after_market uuid, max_count integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  who uuid := auth.uid();
  person uuid;
  money numeric(20, 6);
  ids uuid[];
begin
  if who is null then
    raise exception 'Positions are read for a signed-in account' using errcode = 'insufficient_privilege';
  end if;
  if max_count is null or max_count not between 1 and 100 then
    raise exception 'A page holds 1 to 100 positions' using errcode = 'invalid_parameter_value';
  end if;
  select a.id, a.balance into person, money
  from ledger.accounts a where a.kind = 'person' and a.user_id = who;
  if person is null then
    return jsonb_build_object('balance', 0::numeric(20, 6)::text, 'positions', '[]'::jsonb,
                              'next', null);
  end if;
  select coalesce(array_agg(x.market_id order by x.market_id desc), '{}') into ids
  from (
    select p.market_id
    from markets.positions p
    join markets.markets m on m.id = p.market_id
    join markets.details d on d.market_id = p.market_id
    where p.account_id = person
      and (p.yes_shares > 0 or p.no_shares > 0)
      and m.state in ('open', 'closed')
      and (after_market is null or p.market_id < after_market)
    order by p.market_id desc
    limit max_count + 1
  ) x;
  return jsonb_build_object(
    'balance', money::text,
    'positions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'market_id', m.id,
        'question', d.question,
        'state', m.state,
        'closes_at', markets.utc(m.closes_at),
        'yes', p.yes_shares::text,
        'no', p.no_shares::text,
        'probability', markets.probability(m.p, m.pool_yes, m.pool_no)::text
      ) order by i.n)
      from unnest(ids[1:max_count]) with ordinality as i (id, n)
      join markets.markets m on m.id = i.id
      join markets.details d on d.market_id = i.id
      join markets.positions p on p.market_id = i.id and p.account_id = person
    ), '[]'::jsonb),
    'next', case when cardinality(ids) > max_count then ids[max_count] end
  );
end;
$$;


-- 4. The signed-in person's open orders --------------------------------------------------------------

-- Their limit orders still resting: not filled, not cancelled, and not past their expiry (read by the
-- clock now: an expired order is marked as such only by the market's next trade, so this never waits
-- for one), in markets still open or waiting to be settled, newest first, up to `max_count` at a time;
-- `after_order` is the last order of the page before, and must be one of theirs. Answers
-- {"orders": [{"id", "market_id", "question", "state", "outcome", "order_amount", "amount",
--  "shares", "limit_prob", "expires_at", "created_at"}, ...], "next": the order ID to ask after for
-- the next page, or null}. `amount` and `shares` are what the order has filled so far, of its
-- `order_amount`.
create function trading.orders(after_order uuid, max_count integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  who uuid := auth.uid();
  read_at timestamptz := clock_timestamp();
  person uuid;
  after_at timestamptz;
  ids uuid[];
begin
  if who is null then
    raise exception 'Orders are read for a signed-in account' using errcode = 'insufficient_privilege';
  end if;
  if max_count is null or max_count not between 1 and 100 then
    raise exception 'A page holds 1 to 100 orders' using errcode = 'invalid_parameter_value';
  end if;
  select a.id into person from ledger.accounts a where a.kind = 'person' and a.user_id = who;
  if person is null then
    if after_order is not null then
      raise exception 'No such order on this account' using errcode = 'invalid_parameter_value';
    end if;
    return jsonb_build_object('orders', '[]'::jsonb, 'next', null);
  end if;
  if after_order is not null then
    select t.created_at into after_at
    from markets.trades t where t.id = after_order and t.account_id = person;
    if not found then
      raise exception 'No such order on this account' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  select coalesce(array_agg(x.id order by x.created_at desc, x.id desc), '{}') into ids
  from (
    select t.id, t.created_at
    from markets.trades t
    join markets.markets m on m.id = t.market_id
    join markets.details d on d.market_id = t.market_id
    where t.account_id = person
      and t.limit_prob is not null and not t.is_filled and not t.is_cancelled
      and (t.expires_at is null or t.expires_at > read_at)
      and m.state in ('open', 'closed')
      and (after_order is null or (t.created_at, t.id) < (after_at, after_order))
    order by t.created_at desc, t.id desc
    limit max_count + 1
  ) x;
  return jsonb_build_object(
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'market_id', t.market_id,
        'question', d.question,
        'state', m.state,
        'outcome', t.outcome,
        'order_amount', t.order_amount::text,
        'amount', t.amount::text,
        'shares', t.shares::text,
        'limit_prob', t.limit_prob::text,
        'expires_at', markets.utc(t.expires_at),
        'created_at', markets.utc(t.created_at)
      ) order by i.n)
      from unnest(ids[1:max_count]) with ordinality as i (id, n)
      join markets.trades t on t.id = i.id
      join markets.markets m on m.id = t.market_id
      join markets.details d on d.market_id = t.market_id
    ), '[]'::jsonb),
    'next', case when cardinality(ids) > max_count then ids[max_count] end
  );
end;
$$;

-- A person's resting orders, newest first (the open-orders index the ledger has is by market).
create index trades_open_orders_by_account on markets.trades (account_id, created_at desc, id desc)
  where limit_prob is not null and not is_filled and not is_cancelled;


-- Who may call what -----------------------------------------------------------------------------------
-- The app's own role may call the four reads, and nothing else new.

revoke all on all functions in schema trading from public, anon, authenticated, service_role;
grant usage on schema trading to hrizzup_app;
grant execute on function trading.markets(uuid, integer) to hrizzup_app;
grant execute on function trading.holdings(uuid) to hrizzup_app;
grant execute on function trading.positions(uuid, integer) to hrizzup_app;
grant execute on function trading.orders(uuid, integer) to hrizzup_app;
