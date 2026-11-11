-- The public API's market data and a bot's own trades (PLAN.md steps 3.5c and 3.5d, with 3.4b's price
-- reads; Round 5's relay R5, its database change, first and on its own): read-only functions the
-- website's API calls, as the app's own role, for the reads every market page and every bot needs
-- (docs/research/public-api.md, sections 2.1 and 2.8). Nothing here writes, locks or changes a table.
--
-- - Schema market_data, public reads, the same for everyone (so the API keeps them at the edge),
--   read with nobody signed in, and never naming who traded (decision 5): one market (any that isn't
--   a draft), its history (the chance after each trade), its resting limit orders by price, its
--   latest trades, what a quote needs (the market as a trade would find it, the owners of its resting
--   orders replaced by tokens that name nobody), our own Bitcoin price and its history, and what a
--   perp quote needs (the perp's book, its positions' owners likewise replaced).
-- - trading.my_trades: the signed-in account's own trades, newest first, a page at a time, each
--   saying whether a bot's key placed it (Manifold's `isApi`).
-- - A market settled at a set probability stays out of every public read, as it stays off the list,
--   until the agreement's market/2 can describe it (PLAN.md section 2, "Markets").
-- - Histories over the usual ranges (1h, 1d, 1w, 1m, all): every point when there are at most 1,000,
--   else the last in each of 1,000 equal slices of the range, so a chart never asks for more.
-- - Two indexes for the reads that search by time: a market's trades, and an account's.
--
-- Only additions: everything on staging keeps working as before.


-- 1. The schema ----------------------------------------------------------------------------------------

create schema market_data;
comment on schema market_data is
  'The public API''s market data (PLAN.md steps 3.5c and 3.4b): read-only functions, the same answer '
  'for everyone, never naming who traded. Reached only through its functions, by the app''s role.';
revoke all on schema market_data from public;

-- The most points a history gives: every one when there are no more, else one a slice.
create function market_data.most_points()
returns integer
language sql
immutable
set search_path = ''
as $$
  select 1000;
$$;

-- Where a history over `range` starts: that long before now, but never before `first` (when the
-- market opened, or the first stored price). Refuses any other range.
create function market_data.range_start(range text, first timestamptz)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
begin
  return case range_start.range
    when '1h' then greatest(first, now() - interval '1 hour')
    when '1d' then greatest(first, now() - interval '1 day')
    when '1w' then greatest(first, now() - interval '7 days')
    when '1m' then greatest(first, now() - interval '30 days')
    when 'all' then first
    else null
  end;
end;
$$;

create function market_data.check_range(range text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if check_range.range is null or check_range.range not in ('1h', '1d', '1w', '1m', 'all') then
    raise exception 'A range is 1h, 1d, 1w, 1m or all' using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

-- A market anyone may read: any that isn't a draft, nor settled at a set probability (which market/1
-- can't describe yet). Null for anything else.
create function market_data.readable(wanted uuid)
returns markets.markets
language sql
stable
security definer
set search_path = ''
as $$
  select m.*
  from markets.markets m
  where m.id = wanted and m.state <> 'draft' and m.resolution is distinct from 'MKT';
$$;


-- 2. One market --------------------------------------------------------------------------------------

-- {"market": the agreement's record (market/1), "probability": its chance of Yes while open or
-- closed, else null}, or null when nobody may read it. Listed or not: a market's address is enough.
create function market_data.one_market(wanted uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'market', markets.market_record(m.id),
    'probability', case when m.state in ('open', 'closed')
                        then markets.probability(m.p, m.pool_yes, m.pool_no)::text end)
  from market_data.readable(wanted) m
  where m.id is not null;
$$;


-- 3. A market's history: its chance after each trade ------------------------------------------------

-- {"range", "from": where it starts, "points": [{"at", "probability"}, ...] in time order}: first the
-- chance as the range starts (after the last trade before it, or the starting probability), then the
-- chance after each trade in it (the last of each slice when there are more than the most). Null when
-- nobody may read the market.
create function market_data.market_history(wanted uuid, range text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  m markets.markets;
  opened timestamptz;
  since timestamptz;
  until_at timestamptz := now();
  starting numeric;
  counted integer;
  most integer := market_data.most_points();
  found_points jsonb;
begin
  perform market_data.check_range(range);
  select * into m from market_data.readable(wanted) r where r.id is not null;
  if m.id is null then
    return null;
  end if;
  select least(d.opens_at, (select min(t.created_at) from markets.trades t where t.market_id = m.id))
    into opened
  from markets.details d where d.market_id = m.id;
  opened := coalesce(opened, m.created_at);
  since := market_data.range_start(range, opened);

  select t.prob_after into starting
  from markets.trades t
  where t.market_id = m.id and t.created_at < since and t.prob_after is not null
  order by t.number desc
  limit 1;
  -- Before any trade, the pool's two sides are equal, so its chance is its constant p.
  starting := coalesce(starting, m.p);

  select count(distinct t.number) into counted
  from markets.trades t
  where t.market_id = m.id and t.created_at >= since and t.prob_after is not null;

  with each_trade as (
    select distinct on (t.number) t.number, t.created_at, t.prob_after
    from markets.trades t
    where t.market_id = m.id and t.created_at >= since and t.prob_after is not null
    order by t.number
  ),
  kept as (
    select e.number, e.created_at, e.prob_after
    from each_trade e
    where counted < most
    union all
    (select distinct on (s.slice) s.number, s.created_at, s.prob_after
     from (
       select e.*, width_bucket(
                extract(epoch from e.created_at),
                extract(epoch from since),
                extract(epoch from until_at) + 0.001,
                most - 1) as slice
       from each_trade e
     ) s
     where counted >= most
     order by s.slice, s.number desc)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'at', markets.utc(k.created_at), 'probability', k.prob_after::text) order by k.number),
         '[]'::jsonb)
    into found_points
  from kept k;

  return jsonb_build_object(
    'range', range,
    'from', markets.utc(since),
    'points', jsonb_build_array(jsonb_build_object(
                'at', markets.utc(since), 'probability', starting::text)) || found_points);
end;
$$;


-- 4. The resting limit orders, by price ----------------------------------------------------------------

-- {"probability": the pool's chance of Yes now (null once settled or cancelled), "yes": [{"limitProb",
-- "amount": what's unfilled at that price, "orders": how many}, ...] best (highest) first, "no": the
-- same, best (lowest) first}, with no names; null when nobody may read the market. Orders that have
-- expired are left out, though no trade has cancelled them yet.
create function market_data.book(wanted uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with resting as (
    select t.outcome, t.limit_prob, sum(t.order_amount - t.amount) as unfilled, count(*) as orders
    from markets.trades t
    where t.market_id = wanted
      and t.limit_prob is not null and not t.is_filled and not t.is_cancelled
      and (t.expires_at is null or t.expires_at > now())
    group by t.outcome, t.limit_prob
  )
  select jsonb_build_object(
    'probability', case when m.state in ('open', 'closed')
                        then markets.probability(m.p, m.pool_yes, m.pool_no)::text end,
    'yes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'limitProb', r.limit_prob::text, 'amount', r.unfilled::text, 'orders', r.orders)
        order by r.limit_prob desc)
      from resting r where r.outcome = 'YES'), '[]'::jsonb),
    'no', coalesce((
      select jsonb_agg(jsonb_build_object(
        'limitProb', r.limit_prob::text, 'amount', r.unfilled::text, 'orders', r.orders)
        order by r.limit_prob asc)
      from resting r where r.outcome = 'NO'), '[]'::jsonb))
  from market_data.readable(wanted) m
  where m.id is not null;
$$;


-- 5. The latest trades -----------------------------------------------------------------------------------

-- {"trades": [{"id", "outcome", "action": buy or sell, "amount", "shares", "limitProb", "probBefore",
-- "probAfter", "at"}, ...] newest first, "next": the number to ask before for the next page, or null},
-- with no names; null when nobody may read the market. Each is a buy or a sale as it was placed: what
-- it paid (below zero: received) and the shares it got (below zero: sold) then. A limit order that
-- filled nothing when placed isn't a trade yet: the trades that later reach it are.
create function market_data.trades(wanted uuid, before_number integer, max_count integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  m markets.markets;
  numbers integer[];
begin
  if max_count is null or max_count not between 1 and 100 then
    raise exception 'A page holds 1 to 100 trades' using errcode = 'invalid_parameter_value';
  end if;
  if before_number is not null and before_number < 1 then
    raise exception 'No such page' using errcode = 'invalid_parameter_value';
  end if;
  select * into m from market_data.readable(wanted) r where r.id is not null;
  if m.id is null then
    return null;
  end if;
  select coalesce(array_agg(x.number order by x.number desc), '{}') into numbers
  from (
    select t.number
    from markets.trades t
    where t.market_id = m.id
      and t.kind in ('buy', 'sell')
      and (before_number is null or t.number < before_number)
      and exists (
        select 1 from markets.fills f where f.trade_id = t.id and f.created_at = t.created_at)
    order by t.number desc
    limit max_count + 1
  ) x;
  return jsonb_build_object(
    'trades', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'outcome', t.outcome,
        'action', t.kind,
        'amount', f.amount::text,
        'shares', f.shares::text,
        'limitProb', t.limit_prob::text,
        'probBefore', t.prob_before::text,
        'probAfter', t.prob_after::text,
        'at', markets.utc(t.created_at)
      ) order by i.n)
      from unnest(numbers[1:max_count]) with ordinality as i (number, n)
      join markets.trades t
        on t.market_id = m.id and t.number = i.number and t.kind in ('buy', 'sell')
      cross join lateral (
        select sum(f.amount) as amount, sum(f.shares) as shares
        from markets.fills f where f.trade_id = t.id and f.created_at = t.created_at
      ) f
    ), '[]'::jsonb),
    'next', case when cardinality(numbers) > max_count then numbers[max_count] end
  );
end;
$$;


-- 6. What a quote needs -------------------------------------------------------------------------------

-- The market as a trade placed now would find it, as markets.begin_trade hands it to the server's
-- maths, but without taking a lock or reading anyone's own holdings: {"now", "market": {"id", "state",
-- "closes_at", "p", "pool_yes", "pool_no", "seed"}, "orders": [{"id", "account_id", "outcome",
-- "order_amount", "amount", "shares", "limit_prob", "expires_at", "created_at"}, ...] in the order they
-- were placed, "balances": {owner: balance}}. Each resting order's owner is a token ("o1", "o2"...)
-- that names nobody and lasts only for this answer, with what that owner can still pay, since the
-- maths stops at an owner's balance. Null when nobody may read the market. The server runs the same
-- maths a trade runs on it, writing nothing, so a quote matches the trade that follows to the exact
-- decimal unless another trade comes between.
create function market_data.quote_state(wanted uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  m markets.markets;
  quote_at timestamptz;
begin
  select * into m from market_data.readable(wanted) r where r.id is not null;
  if m.id is null then
    return null;
  end if;
  quote_at := date_trunc('milliseconds',
    greatest(clock_timestamp(), coalesce(m.last_trade_at, '-infinity')));
  return (
    with resting as (
      select t.*
      from markets.trades t
      where t.market_id = m.id
        and t.limit_prob is not null and not t.is_filled and not t.is_cancelled
        and (t.expires_at is null or t.expires_at > quote_at)
    ),
    owners as (
      select o.account_id, 'o' || row_number() over (order by min(o.number)) as token
      from resting o
      group by o.account_id
    )
    select jsonb_build_object(
      'now', quote_at,
      'market', jsonb_build_object(
        'id', m.id,
        'state', m.state,
        'closes_at', m.closes_at,
        'p', m.p::text,
        'pool_yes', m.pool_yes::text,
        'pool_no', m.pool_no::text,
        'seed', m.seed::text),
      'orders', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', r.id,
          'account_id', w.token,
          'outcome', r.outcome,
          'order_amount', r.order_amount::text,
          'amount', r.amount::text,
          'shares', r.shares::text,
          'limit_prob', r.limit_prob::text,
          'expires_at', r.expires_at,
          'created_at', r.created_at
        ) order by r.number)
        from resting r join owners w on w.account_id = r.account_id), '[]'::jsonb),
      'balances', coalesce((
        select jsonb_object_agg(w.token, a.balance::text)
        from owners w join ledger.accounts a on a.id = w.account_id), '{}'::jsonb))
  );
end;
$$;


-- 7. Our own Bitcoin price ------------------------------------------------------------------------------

-- The newest stored price of a feed: {"feed", "at", "price", "sources", "publishedAt"}, or null before
-- the first. Only our median is ever given, never an exchange's own answer.
create function market_data.price(feed text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select prices.latest(price.feed);
$$;

-- {"feed", "range", "from", "points": [{"at", "price"}, ...] in time order}: every stored price in the
-- range (5-second ones for 30 days, then each minute's last), or the last of each of 1,000 equal slices
-- of it when there are more. Null before the first price.
create function market_data.price_history(feed text, range text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  first_at timestamptz;
  since timestamptz;
  until_at timestamptz := now();
  counted integer;
  most integer := market_data.most_points();
  found_points jsonb;
begin
  perform market_data.check_range(range);
  select min(x.at) into first_at from prices.points x where x.feed = price_history.feed;
  if first_at is null then
    return null;
  end if;
  since := market_data.range_start(range, first_at);
  select count(*) into counted
  from prices.points x where x.feed = price_history.feed and x.at >= since;

  with stored as (
    select x.at, x.price
    from prices.points x
    where x.feed = price_history.feed and x.at >= since
  ),
  kept as (
    select s.at, s.price from stored s where counted <= most
    union all
    (select distinct on (b.slice) b.at, b.price
     from (
       select s.*, width_bucket(
                extract(epoch from s.at),
                extract(epoch from since),
                extract(epoch from until_at) + 0.001,
                most) as slice
       from stored s
     ) b
     where counted > most
     order by b.slice, b.at desc)
  )
  select coalesce(jsonb_agg(jsonb_build_object('at', markets.utc(k.at), 'price', k.price::text)
                            order by k.at), '[]'::jsonb)
    into found_points
  from kept k;

  return jsonb_build_object(
    'feed', price_history.feed,
    'range', range,
    'from', markets.utc(since),
    'points', found_points);
end;
$$;


-- 8. What a perp quote needs ------------------------------------------------------------------------------

-- The perp as an open placed now would find it, as perps.begin_step hands it to the server's maths, but
-- without taking a lock or reading anyone's own holdings ("trader" is null): each open position's
-- owner and ID, and the pools' accounts, are tokens that name nobody and last only for this answer.
-- Null for no such perp. The quote is the price now's: an order fills at the next price, so its fee
-- and liquidation price move with it.
create function market_data.perp_quote_state(wanted uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p perps.perps;
  quote_at timestamptz;
  newest prices.points;
begin
  select * into p from perps.perps x where x.id = wanted;
  if not found then
    return null;
  end if;
  quote_at := date_trunc('milliseconds', greatest(clock_timestamp(), p.updated_at));
  if p.feed = 'btc-usd' then
    select * into newest from prices.points x where x.feed = p.feed order by x.at desc limit 1;
  end if;
  return jsonb_build_object(
    'now', markets.utc(quote_at),
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
      'point', case when newest.at is null then null else prices.point_of(newest) end,
      'settings', perps.settings_of(p),
      'price', p.price::text,
      'priceAt', markets.utc(p.price_at),
      'fundingFrom', markets.utc(p.funding_from),
      'lastFundingAt', markets.utc(p.last_funding_at),
      'pausedReason', p.paused_reason,
      'longAccountId', 'pool-long',
      'shortAccountId', 'pool-short'),
    'pools', jsonb_build_object(
      'long', (select a.balance from ledger.accounts a where a.id = p.long_account_id)::text,
      'short', (select a.balance from ledger.accounts a where a.id = p.short_account_id)::text),
    'positions', coalesce((
      select jsonb_agg(perps.position_of(x)
                       || jsonb_build_object('id', 'p' || o.n, 'accountId', 'o' || o.owner)
                       order by o.n)
      from (
        select y.*, row_number() over (order by y.opened_at, y.id) as n,
               dense_rank() over (order by y.account_id) as owner
        from perps.positions y
        where y.perp_id = p.id and y.closed_at is null
      ) o
      join perps.positions x on x.id = o.id), '[]'::jsonb),
    'trader', null
  );
end;
$$;


-- 9. A bot's own trades -----------------------------------------------------------------------------------

-- The signed-in account's own trades in every market, newest first, a page at a time:
-- {"trades": [{"id", "market_id", "question", "action": buy, sell or redeem, "outcome" (null for a
-- redemption: Yes and No held together, paid Ṁ1 a pair), "amount", "shares", "order_amount",
-- "limit_prob", "expires_at", "is_filled", "is_cancelled", "cancel_reason", "prob_before",
-- "prob_after", "request_id", "is_api": whether a bot's key placed it, "at"}, ...], "next": the trade
-- ID to ask after for the next page, or null}. A limit order's amount and shares are what it has
-- filled so far.
create function trading.my_trades(after_trade uuid, max_count integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  who uuid := auth.uid();
  person uuid;
  after_at timestamptz;
  ids uuid[];
begin
  if who is null then
    raise exception 'Trades are read for a signed-in account' using errcode = 'insufficient_privilege';
  end if;
  if max_count is null or max_count not between 1 and 100 then
    raise exception 'A page holds 1 to 100 trades' using errcode = 'invalid_parameter_value';
  end if;
  select a.id into person from ledger.accounts a where a.kind = 'person' and a.user_id = who;
  if person is null then
    if after_trade is not null then
      raise exception 'No such trade on this account' using errcode = 'invalid_parameter_value';
    end if;
    return jsonb_build_object('trades', '[]'::jsonb, 'next', null);
  end if;
  if after_trade is not null then
    select t.created_at into after_at
    from markets.trades t where t.id = after_trade and t.account_id = person;
    if not found then
      raise exception 'No such trade on this account' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  select coalesce(array_agg(x.id order by x.created_at desc, x.id desc), '{}') into ids
  from (
    select t.id, t.created_at
    from markets.trades t
    where t.account_id = person
      and (after_trade is null or (t.created_at, t.id) < (after_at, after_trade))
    order by t.created_at desc, t.id desc
    limit max_count + 1
  ) x;
  return jsonb_build_object(
    'trades', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'market_id', t.market_id,
        'question', d.question,
        'action', t.kind,
        'outcome', t.outcome,
        'amount', t.amount::text,
        'shares', t.shares::text,
        'order_amount', t.order_amount::text,
        'limit_prob', t.limit_prob::text,
        'expires_at', markets.utc(t.expires_at),
        'is_filled', t.is_filled,
        'is_cancelled', t.is_cancelled,
        'cancel_reason', t.cancel_reason,
        'prob_before', t.prob_before::text,
        'prob_after', t.prob_after::text,
        'request_id', t.request_id,
        'is_api', r.api_key_id is not null,
        'at', markets.utc(t.created_at)
      ) order by i.n)
      from unnest(ids[1:max_count]) with ordinality as i (id, n)
      join markets.trades t on t.id = i.id
      join markets.details d on d.market_id = t.market_id
      left join markets.requests r on r.account_id = t.account_id and r.id = t.request_id
    ), '[]'::jsonb),
    'next', case when cardinality(ids) > max_count then ids[max_count] end
  );
end;
$$;


-- 10. Indexes for the reads that search by time ------------------------------------------------------------

-- A market's trades from a moment on (its history).
create index trades_by_market_time on markets.trades (market_id, created_at);
-- An account's trades, newest first (its own trades).
create index trades_by_account_time on markets.trades (account_id, created_at desc, id desc);


-- 11. Who may call what ------------------------------------------------------------------------------------
-- The app's own role may call the reads, and nothing else new; nobody else may call anything here.

revoke all on all functions in schema market_data from public, anon, authenticated, service_role;
revoke all on function trading.my_trades(uuid, integer) from public, anon, authenticated, service_role;
grant usage on schema market_data to hrizzup_app;
grant execute on function market_data.one_market(uuid) to hrizzup_app;
grant execute on function market_data.market_history(uuid, text) to hrizzup_app;
grant execute on function market_data.book(uuid) to hrizzup_app;
grant execute on function market_data.trades(uuid, integer, integer) to hrizzup_app;
grant execute on function market_data.quote_state(uuid) to hrizzup_app;
grant execute on function market_data.price(text) to hrizzup_app;
grant execute on function market_data.price_history(text, text) to hrizzup_app;
grant execute on function market_data.perp_quote_state(uuid) to hrizzup_app;
grant execute on function trading.my_trades(uuid, integer) to hrizzup_app;
