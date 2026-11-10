-- The perp's books, a second pass (PLAN.md step 3.4a), from the AI review of the perp's calls and
-- jobs: each change below adds a rule or widens one only where Manifold's own maths needs it, and
-- the books keep checking everything they checked.
--
-- 1. The pools balance as Manifold's maths balances them. When one side's pool has fallen below
--    what its own side's positions could be paid back (a winner on the other side was paid its
--    profit while this side was losing, and the price then came back), Manifold moves the shortfall
--    across from the other pool, if that pool has room to spare, with no position changing. The
--    books took such a move only alongside winners scaled down, so a perp in that state refused
--    every new price and trade until one appeared. Now a new price may move money from one pool to
--    the other on its own, one way only, the receiving pool ending no higher than its own side's
--    margins (the bound the books already held it to); a trade still never moves money between the
--    pools.
-- 2. Funding on each perp's own hourly slots. Manifold runs funding from an hourly scheduler and
--    gives it a minute's grace (a run up to a minute early still counts), so a check that runs more
--    often than hourly would take that minute every time and fund every 59 minutes, drifting (R3's
--    finding). Each perp's funding falls due on hourly slots of its own, anchored to its first
--    period: the first a whole period after it, then the slot after the one the last ran in, never
--    sooner than the engine takes one; and the books refuse a funding before its slot, whatever
--    asks for it.
-- 3. The scheduled jobs leave a check run's test perp alone two hours after it's made: long enough
--    for any run, so a run that failed before switching its perp off stops costing anything.
-- 4. The listed perp can't be switched on (or to closing only) where its scheduled jobs aren't set
--    up, so it never runs with no one to liquidate its positions or pay its funding.

-- 1. The pools balance as Manifold's maths balances them (see the top of this file).
create or replace function perps.apply_step(plan jsonb)
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
  -- move to each other only where the maths balances them (with a new price: a side's pool short
  -- of its own side's margins topped up by the other, and winners scaled down; or funding), never
  -- in the trade; and each person's moves in each phase exactly what their events say.
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
       or (f.kind <> 'person' and t.kind <> 'person' and m ->> 'phase' = 'trade')
  ) then
    raise exception 'A move to or from someone the step can''t pay or charge'
      using errcode = 'check_violation';
  end if;
  -- An open's margin and fee go into the trader's own side's pool, and a close puts nothing in;
  -- a close's payout comes from its own side's pool (at most the margin it closed) and the other's
  -- (at most its profit); funding moves only from the crowded side's pool to the other; and a pool
  -- topped up by the other with a new price ends no higher than its own side's margins, one way only
  -- (Manifold moves a side's shortfall across only from a side with room to spare).
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
  ) or (
    select count(distinct m ->> 'from') from jsonb_array_elements(moves_in) m
    where m ->> 'phase' = 'price'
      and (m ->> 'from')::uuid in (p.long_account_id, p.short_account_id)
      and (m ->> 'to')::uuid in (p.long_account_id, p.short_account_id)
  ) > 1 then
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

-- 2. When a perp's next funding falls due: on hourly slots of its own (see the top of this file).
create function perps.next_funding_at(p perps.perps)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
    when p.last_funding_at is null then
      p.funding_from + make_interval(secs => p.funding_period_ms / 1000.0)
    else greatest(
      p.funding_from + make_interval(secs => p.funding_period_ms / 1000.0 * (
        floor(extract(epoch from (p.last_funding_at - p.funding_from)) * 1000 / p.funding_period_ms) + 1)),
      p.last_funding_at + make_interval(secs => (p.funding_period_ms - 60000) / 1000.0))
  end;
$$;
revoke all on function perps.next_funding_at(perps.perps) from public, anon, authenticated, service_role;

-- The books hold to it whoever asks: a funding before its perp's next slot is refused.
create function perps.funding_on_its_slot()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  p perps.perps;
begin
  select * into p from perps.perps x where x.id = new.perp_id;
  if new.at < perps.next_funding_at(p) then
    raise exception 'Funding runs once a period, on its perp''s own hourly slots'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function perps.funding_on_its_slot() from public, anon, authenticated, service_role;
create trigger fundings_on_their_slots
  before insert on perps.fundings
  for each row execute function perps.funding_on_its_slot();

-- 2 and 3. Whether a perp has work for a scheduled job at a moment: switched on, with an open
-- position; for funding, its slot come round; and a check run's test perp only for its first two
-- hours.
create function perps.has_work(p perps.perps, job text, at timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select job in ('tick', 'funding')
    and p.state = 'live'
    and p.trading_mode <> 'halted'
    and (p.listed or p.created_at > at - interval '2 hours')
    and exists (select 1 from perps.positions x where x.perp_id = p.id and x.closed_at is null)
    and (job = 'tick' or at >= perps.next_funding_at(p));
$$;
revoke all on function perps.has_work(perps.perps, text, timestamptz)
  from public, anon, authenticated, service_role;

-- The perps with work for a scheduled job now.
create or replace function perps.due(job text)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(p.id order by p.id), '{}')
  from perps.perps p
  where perps.has_work(p, job, clock_timestamp());
$$;

-- 4. The listed perp stays off where its scheduled jobs aren't set up.
create or replace function admin.set_perp_mode(perp uuid, mode text, reason text)
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
  -- The listed perp runs only where its scheduled jobs can: switched on (or closing only) with
  -- nobody running its prices, liquidations and funding, positions would sit past their
  -- liquidation price. So it stays off until this environment's jobs are set up: their address and
  -- secret in Supabase Vault (infra/supabase/perps_jobs.py). A check run's test perps are driven by
  -- their own runs and tests.
  if p.listed and mode <> 'halted' and mode <> p.trading_mode and (
       not exists (select 1 from vault.secrets s where s.name = 'perps_jobs_url')
       or not exists (select 1 from vault.secrets s where s.name = 'perps_jobs_secret')) then
    raise exception 'The perp stays off until this environment''s scheduled jobs are set up'
      using errcode = 'object_not_in_prerequisite_state';
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
