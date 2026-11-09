-- The trade call's check before the books, made safe for a retried request (PLAN.md step 1.7d; found
-- by the AI review of the typed API's trading calls). Database changes land first: the typed API's
-- trade and cancel calls use it in the next pull request.
--
-- The trade call reads the person's holdings and refuses, before it touches the books, an amount over
-- the balance, shares over those held, or a market that isn't open. But the books keep every answer
-- under its request's ID, and a retry of a request they have already answered must get that answer
-- back: a buy of the whole balance that filled, retried after its answer was lost, would otherwise be
-- refused for the balance it spent. So trading.holdings now also takes the request's ID and says
-- whether the signed-in person has already sent a request with it ("answered"); when they have, the
-- call skips its own checks and goes straight to the books, which answer as they did the first time,
-- or refuse a different request sent under the same ID.
--
-- The one-argument trading.holdings (20261109172041_trading_reads.sql) is removed: nothing has ever
-- called it, since the code that would has not merged, so nothing on staging stops working.


-- Their balance (zero while they have no play money yet) and their Yes and No shares in `market`,
-- with the market's state and closing time, and whether they have already sent a request with the ID
-- `request` (in any market); null when there's no such market, or it's a draft, which exists only
-- for admins until it opens. Read before a trade, outside its transaction: the trade checks all of it
-- again under the market's lock.
create function trading.holdings(market uuid, request uuid)
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
      'no', coalesce(p.no_shares, 0)::numeric(20, 6)::text,
      'answered', exists (
        select 1 from markets.requests r where r.account_id = a.id and r.id = holdings.request)
    )
    from markets.markets m
    left join ledger.accounts a on a.kind = 'person' and a.user_id = who
    left join markets.positions p on p.market_id = m.id and p.account_id = a.id
    where m.id = holdings.market
      and m.state <> 'draft'
  );
end;
$$;

drop function trading.holdings(uuid);

-- Who may call it: the app's own role, as the other trading reads.
revoke all on function trading.holdings(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function trading.holdings(uuid, uuid) to hrizzup_app;
