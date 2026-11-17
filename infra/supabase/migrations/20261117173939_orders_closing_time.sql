-- trading.orders also says when each order's market closes (Round 6, R4: the API's GET /me/orders shows
-- a market past its closing time as closed, though its stored state stays `open` until the desk closes
-- it, so the read needs the closing time, in the same form holdings and positions give it).
--
-- Adds one key to each order, "closes_at", the market's closing time as the agreement writes a time
-- (markets.utc). Nothing else changes: same signature, same properties, same grant (a replaced
-- function keeps its grants), and the body is the one in 20261109172041_trading_reads.sql, with that key
-- added. An order now reads
-- {"id", "market_id", "question", "state", "outcome", "order_amount", "amount", "shares", "limit_prob",
--  "expires_at", "created_at", "closes_at"}.

create or replace function trading.orders(after_order uuid, max_count integer)
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
        'created_at', markets.utc(t.created_at),
        'closes_at', markets.utc(m.closes_at)
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
