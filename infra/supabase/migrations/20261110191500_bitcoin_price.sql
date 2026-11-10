-- Our own Bitcoin price (PLAN.md step 3.4b, milestone 1 of 3: its database change, first and on its
-- own), as the Product chat settled it on 10 November 2026 (docs/research/public-api.md, section 4,
-- decisions 6, 7, 8 and 10):
--
-- - Every 5 seconds, inside the database (Supabase Cron, which already runs the perp's jobs), ask
--   Coinbase, Kraken and Bitstamp for Bitcoin's price in US dollars through pg_net, with Gemini as
--   the spare, asked only when one of them fails, and store the median once (prices.points). That
--   stored price is the only price: the website, the app and every bot read it, and a perp on it
--   applies only it, exactly.
-- - The median: an answer more than 1% from the median of all the answers is dropped; the price is
--   the median of the three main exchanges' answers left (with two, their average), Gemini's standing
--   in for any of them missing or dropped; at least two are needed. To the cent.
-- - When prices stop: the last one is held (stored again at each ask) for 30 seconds after the last
--   real one; then nothing is stored until prices return. Each order fills at a price stored after it
--   was placed, and only a new price liquidates, so after 30 seconds without one the perp fills no
--   order and liquidates no one; both start again with the next price.
-- - History: every 5-second price for 30 days, then each minute's last. Each exchange's own answers
--   stay inside the database (prices.quotes), for two days: only our median is ever published (the
--   exchanges' terms, docs/research/public-api.md, section 2.7).
-- - Only while a perp on this price is switched on, and only where the perp's scheduled jobs are set
--   up (their address in Supabase Vault, as on staging): never on a check's fresh database or this
--   Mac's, so no check ever calls an exchange. Production's perp is off, so production asks nothing.
-- - The perp: the listed perp may move, once, from its stand-in to this price (a later migration
--   moves it, once the website reads it); a check run's test perps keep their seeded stand-in. A step
--   on a perp on this price hands over the newest stored price, and the books apply only that one.
-- - Inside the current plans: Supabase Cron, pg_net and Vault come with every Supabase plan, and the
--   exchanges' free public prices need no key. Each ask is one request to each of the three (17,280
--   a day each, the spare's only when needed), well inside the tightest limit, Kraken's, about one a
--   second per address. Nothing here calls the website. (The perp's ticks call it only while someone
--   holds a position; Vercel Pro now counts those calls against its $20 monthly credit, $0.60 a
--   million in Mumbai plus their CPU and memory time, cents a month, rather than the million included
--   calls the perp jobs' migration names: R2's finding, docs/status/product.md.)
--
-- Everything here only adds: the website on staging keeps working on the stand-in as before.


-- 1. The stored price and each exchange's answers ---------------------------------------------------

create schema prices;
comment on schema prices is
  'Our own prices (PLAN.md step 3.4b): Bitcoin in US dollars about every 5 seconds, the median of '
  'big exchanges'' free public prices, stored once; and each exchange''s own answers, never shown. '
  'Reached only through its functions.';
revoke all on schema prices from public;

create table prices.points (
  feed text not null,
  at timestamptz not null,
  price numeric(20, 2) not null,
  sources smallint not null,
  published_at timestamptz not null,
  primary key (feed, at),
  constraint points_feed check (feed = 'btc-usd'),
  constraint points_price check (price > 0 and price < 'Infinity'),
  constraint points_sources check (sources in (0, 2, 3)),
  constraint points_published check (published_at >= at)
);
comment on table prices.points is
  'Our price, once an ask (about every 5 seconds): `at` is when the exchanges were asked, so a price '
  'stored after an order was placed was also asked for after it; the median of the answers used '
  '(`sources`: 2 or 3), or the last real price held (`sources` 0) for up to 30 seconds after it. '
  'Every 5-second price for 30 days, then each minute''s last (prices.tidy). Never edited.';

create table prices.quotes (
  feed text not null,
  at timestamptz not null,
  source text not null,
  request_id bigint not null,
  price numeric,
  outcome text not null default 'asked',
  primary key (feed, at, source),
  constraint quotes_feed check (feed = 'btc-usd'),
  constraint quotes_source check (source in ('coinbase', 'kraken', 'bitstamp', 'gemini')),
  constraint quotes_price check (price is null or (price > 0 and price < 'Infinity')),
  constraint quotes_outcome check (outcome in ('asked', 'used', 'unused', 'dropped', 'failed')),
  constraint quotes_answered check (outcome in ('asked', 'failed') or price is not null)
);
comment on table prices.quotes is
  'Each exchange''s answer to each ask, by pg_net''s request ID: the price it gave (none when it '
  'failed, answered too late or answered anything unreadable) and what became of it: used in the '
  'median, unused (the spare, not needed), dropped (more than 1% from the median of all the '
  'answers) or failed. Kept two days, never shown to anyone: only our median is published.';

create function prices.refuse_edit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'A stored price is never edited (%)', tg_table_name
    using errcode = 'restrict_violation';
end;
$$;
create trigger points_never_edited
  before update on prices.points
  for each row execute function prices.refuse_edit();


-- 2. The exchanges, and reading their answers --------------------------------------------------------

-- The exchanges asked, each for Bitcoin in US dollars (never USDT, which sat 6 to 14 basis points
-- away all through the test), and the one standing by.
create function prices.exchanges()
returns table (source text, url text, spare boolean)
language sql
immutable
set search_path = ''
as $$
  select * from (values
    ('coinbase', 'https://api.exchange.coinbase.com/products/BTC-USD/ticker', false),
    ('kraken', 'https://api.kraken.com/0/public/Ticker?pair=XBTUSD', false),
    ('bitstamp', 'https://www.bitstamp.net/api/v2/ticker/btcusd/', false),
    ('gemini', 'https://api.gemini.com/v1/pubticker/btcusd', true)
  ) e (source, url, spare);
$$;

-- One exchange's answer, as pg_net received it: its last trade's price, or null for anything else
-- (not a 200, not JSON, no price where that exchange puts it, not a plain positive decimal).
create function prices.read_answer(source text, status integer, body text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  doc jsonb;
  figure text;
begin
  if status is distinct from 200 or body is null or not pg_input_is_valid(body, 'jsonb') then
    return null;
  end if;
  doc := body::jsonb;
  if jsonb_typeof(doc) <> 'object' then
    return null;
  end if;
  figure := case read_answer.source
    when 'coinbase' then doc ->> 'price'
    when 'kraken' then case when doc -> 'error' = '[]'::jsonb then doc #>> '{result,XXBTZUSD,c,0}' end
    when 'bitstamp' then doc ->> 'last'
    when 'gemini' then doc ->> 'last'
  end;
  -- A plain decimal, as each exchange writes one: never an exponent, a sign, NaN or infinity.
  if figure is null or figure !~ '^[0-9]{1,9}(\.[0-9]{1,12})?$' then
    return null;
  end if;
  return nullif(figure::numeric, 0);
end;
$$;

-- The median of some prices, exactly: the middle one, or the average of the middle two.
create function prices.median(figures numeric[])
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when s.n = 0 then null
    when s.n % 2 = 1 then s.sorted[(s.n + 1) / 2]
    else (s.sorted[s.n / 2] + s.sorted[s.n / 2 + 1]) / 2
  end
  from (
    select coalesce(array_agg(f order by f), '{}') as sorted, count(f)::integer as n
    from unnest(figures) f
    where f is not null
  ) s;
$$;

-- One ask's answers ([{source, spare, price}], price null for a failure) made into our price: an
-- answer more than 1% from the median of all the answers is dropped; the price is the median of the
-- main exchanges' answers left, the spare's standing in while fewer than three are; at least two
-- are needed. Answers {price (to the cent, or null), sources (how many made it), outcomes (each
-- exchange's: used, unused, dropped or failed)}.
create function prices.combine(answers jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  with given as (
    select x ->> 'source' as source,
           coalesce((x ->> 'spare')::boolean, false) as spare,
           (x ->> 'price')::numeric as price
    from jsonb_array_elements(combine.answers) x
  ),
  judged as (
    select g.*,
           coalesce(g.price is not null and abs(g.price - r.reference) <= r.reference * 0.01,
                    false) as kept
    from given g
    cross join (select prices.median(array_agg(given.price)) as reference from given) r
  ),
  picked as (
    select j.*,
           j.kept and (not j.spare
                       or (select count(*) from judged k where k.kept and not k.spare) < 3) as chosen
    from judged j
  ),
  priced as (
    select case when count(*) filter (where picked.chosen) >= 2
                then round(prices.median(array_agg(picked.price) filter (where picked.chosen)), 2)
           end as price,
           count(*) filter (where picked.chosen) as n
    from picked
  )
  select jsonb_build_object(
    'price', priced.price::text,
    'sources', case when priced.price is null then 0 else priced.n end,
    'outcomes', coalesce((
      select jsonb_object_agg(p.source, case
        when p.price is null then 'failed'
        when not p.kept then 'dropped'
        when p.chosen and priced.price is not null then 'used'
        else 'unused' end)
      from picked p), '{}'::jsonb))
  from priced;
$$;

-- A stored price as everyone reads it.
create function prices.point_of(x prices.points)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'feed', x.feed,
    'at', markets.utc(x.at),
    'price', x.price::text,
    'sources', x.sources,
    'publishedAt', markets.utc(x.published_at));
$$;

-- The newest stored price of a feed, or null before the first.
create function prices.latest(feed text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select prices.point_of(x)
  from prices.points x
  where x.feed = latest.feed
  order by x.at desc
  limit 1;
$$;


-- 3. Asking, every 5 seconds -------------------------------------------------------------------------

-- Whether to ask now: a perp on this price is switched on (enabled or closing only), here where the
-- perp's scheduled jobs are set up (their address in Vault: staging's, never a check's fresh database
-- or this Mac's, which have none, so no check ever calls an exchange).
create function prices.wanted(feed text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
           select 1 from perps.perps p
           where p.feed = wanted.feed and p.state = 'live' and p.trading_mode <> 'halted')
     and exists (select 1 from vault.secrets s where s.name = 'perps_jobs_url');
$$;

-- pg_net sends each request once its transaction commits, keeps each answer for six hours (its
-- request ID finds it; its time, `created`, lets the search use pg_net's index), and gives a whole
-- batch of requests their answers together, once the slowest is in. So the spare, usually the
-- slowest, is asked only when one of the three main exchanges fails, in a batch of its own.

-- One request to one of the exchanges (and nowhere else), through pg_net: 2 seconds at most.
create function prices.request(source text)
returns bigint
language sql
security definer
set search_path = ''
as $$
  select net.http_get(
    url := e.url,
    headers := jsonb_build_object('User-Agent', 'hrizzup-prices'),
    timeout_milliseconds := 2000)
  from prices.exchanges() e
  where e.source = request.source;
$$;

-- One ask: a request to each of the three main exchanges at once (2 seconds at most each), when
-- wanted and at most one every 4 seconds. Gives back the ask's time (its price's `at`), or null when
-- it asked nothing.
create function prices.ask(feed text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  asked timestamptz;
begin
  if ask.feed is distinct from 'btc-usd' then
    raise exception 'No price %', ask.feed using errcode = 'invalid_parameter_value';
  end if;
  if not prices.wanted(ask.feed) then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtext('prices.ask:' || ask.feed));
  asked := date_trunc('milliseconds', clock_timestamp());
  if exists (select 1 from prices.quotes q
             where q.feed = ask.feed and q.at > asked - interval '4 seconds')
     or exists (select 1 from prices.points x where x.feed = ask.feed and x.at >= asked) then
    return null;
  end if;
  insert into prices.quotes (feed, at, source, request_id)
  select ask.feed, asked, e.source, prices.request(e.source)
  from prices.exchanges() e
  where not e.spare;
  return asked;
end;
$$;

-- An ask's answers, as pg_net holds them so far: each exchange asked, whether it has answered (a
-- timeout or an error is an answer too), and the price read from it, if any. pg_net writes one answer
-- a request; any more under the same ID (Supabase's grants let every role write pg_net's tables) and
-- that exchange's answer counts as failed.
create function prices.answers(feed text, asked timestamptz)
returns table (source text, spare boolean, came boolean, price numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select q.source, e.spare, r.n > 0,
         case when r.n = 1 then prices.read_answer(q.source, r.status_code, r.content) end
  from prices.quotes q
  join prices.exchanges() e on e.source = q.source
  cross join lateral (
    select count(*) as n, min(x.status_code) as status_code, min(x.content) as content
    from net._http_response x
    where x.id = q.request_id and x.created >= q.at - interval '5 seconds'
  ) r
  where q.feed = answers.feed and q.at = answers.asked;
$$;

-- Whether every exchange asked has answered.
create function prices.ready(feed text, asked timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(bool_and(a.came), false) from prices.answers(ready.feed, ready.asked) a;
$$;

-- Whether an ask needs the spare: the three main exchanges' answers don't give three prices within 1%
-- of their median (one failed, answered late or far off), and the spare isn't asked yet.
create function prices.needs_spare(feed text, asked timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from prices.quotes q
                 where q.feed = needs_spare.feed and q.at = needs_spare.asked)
     and not exists (select 1 from prices.answers(needs_spare.feed, needs_spare.asked) a where a.spare)
     and (select count(*)
          from prices.answers(needs_spare.feed, needs_spare.asked) a
          cross join (select prices.median(array_agg(b.price)) as mid
                      from prices.answers(needs_spare.feed, needs_spare.asked) b
                      where not b.spare) m
          where not a.spare and a.price is not null and abs(a.price - m.mid) <= m.mid * 0.01) < 3;
$$;

-- The spare, asked for an ask when it needs it, once, under the ask's time (it's asked later still).
-- Gives back whether it asked.
create function prices.ask_spare(feed text, asked timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not prices.needs_spare(ask_spare.feed, ask_spare.asked) then
    return false;
  end if;
  insert into prices.quotes (feed, at, source, request_id)
  select ask_spare.feed, ask_spare.asked, e.source, prices.request(e.source)
  from prices.exchanges() e
  where e.spare;
  return true;
end;
$$;

-- An ask's price, once: each exchange's answer read and judged, and the median stored; with too few
-- answers, the last real price held, for 30 seconds after it; never a price older than the newest.
-- An answer not in yet counts as failed, and one that comes later is never read. Gives back the
-- price stored, or null.
create function prices.settle(feed text, asked timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  combined jsonb;
  last_real prices.points;
  stored prices.points;
begin
  if not exists (select 1 from prices.quotes q where q.feed = settle.feed and q.at = settle.asked) then
    raise exception 'No ask of % at %', settle.feed, settle.asked using errcode = 'no_data_found';
  end if;
  if exists (select 1 from prices.quotes q
             where q.feed = settle.feed and q.at = settle.asked and q.outcome <> 'asked')
     or exists (select 1 from prices.points x where x.feed = settle.feed and x.at >= settle.asked) then
    return null;
  end if;

  update prices.quotes q
  set price = a.price
  from prices.answers(settle.feed, settle.asked) a
  where q.feed = settle.feed and q.at = settle.asked and q.source = a.source;

  select prices.combine(coalesce(jsonb_agg(jsonb_build_object(
           'source', q.source, 'spare', e.spare, 'price', q.price)), '[]'::jsonb))
    into combined
  from prices.quotes q
  join prices.exchanges() e on e.source = q.source
  where q.feed = settle.feed and q.at = settle.asked;

  update prices.quotes q
  set outcome = combined -> 'outcomes' ->> q.source
  where q.feed = settle.feed and q.at = settle.asked;

  if combined ->> 'price' is not null then
    insert into prices.points (feed, at, price, sources, published_at)
    values (settle.feed, settle.asked, (combined ->> 'price')::numeric,
            (combined ->> 'sources')::smallint, greatest(clock_timestamp(), settle.asked))
    returning * into stored;
  else
    select * into last_real
    from prices.points x
    where x.feed = settle.feed and x.sources > 0
    order by x.at desc
    limit 1;
    if last_real.at is not null and settle.asked - last_real.at < interval '30 seconds' then
      insert into prices.points (feed, at, price, sources, published_at)
      values (settle.feed, settle.asked, last_real.price, 0,
              greatest(clock_timestamp(), settle.asked))
      returning * into stored;
    end if;
  end if;
  return case when stored.at is null then null else prices.point_of(stored) end;
end;
$$;

-- One run of the schedule: an ask, then its price. A procedure, so it can commit each ask before
-- waiting for it: pg_net sends nothing until then. It waits for the main exchanges' answers 2.5
-- seconds at most and the spare's, when asked, 2.2 more (each request's own limit is 2 seconds),
-- stopping as soon as they're in (usually well under a second), so even a run that needs the spare
-- ends inside its 5 seconds; Supabase Cron never starts a run while the last is still going. No
-- search path of its own (a procedure that commits can't have one): every name in it is written in
-- full. Only the schedule runs it, as the database's owner. (The commits are checked under Supabase
-- Cron on this Mac and on staging, never in the Database check: its tests run inside a transaction,
-- where a procedure can't commit, and must never ask an exchange.)
create procedure prices.fetch()
language plpgsql
as $$
declare
  asked timestamptz;
begin
  asked := prices.ask('btc-usd');
  if asked is null then
    return;
  end if;
  commit;
  for attempt in 1 .. 25 loop
    exit when prices.ready('btc-usd', asked);
    perform pg_catalog.pg_sleep(0.1);
  end loop;
  if prices.ask_spare('btc-usd', asked) then
    commit;
    for attempt in 1 .. 22 loop
      exit when prices.ready('btc-usd', asked);
      perform pg_catalog.pg_sleep(0.1);
    end loop;
  end if;
  perform prices.settle('btc-usd', asked);
  commit;
end;
$$;

-- Every hour: each minute's last 5-second price kept once it's 30 days old, the rest let go (over
-- the week past that, so a run missed for a few days catches up); each exchange's answers kept two
-- days.
create function prices.tidy()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cutoff timestamptz := date_trunc('minute', clock_timestamp() - interval '30 days', 'UTC');
  thinned integer;
  forgotten integer;
begin
  with ranked as (
    select x.feed, x.at,
           row_number() over (partition by x.feed, date_trunc('minute', x.at, 'UTC')
                              order by x.at desc) as n
    from prices.points x
    where x.feed = 'btc-usd' and x.at < cutoff and x.at >= cutoff - interval '7 days'
  )
  delete from prices.points x
  using ranked r
  where x.feed = r.feed and x.at = r.at and r.n > 1;
  get diagnostics thinned = row_count;
  delete from prices.quotes q
  where q.feed = 'btc-usd' and q.at < clock_timestamp() - interval '2 days';
  get diagnostics forgotten = row_count;
  return jsonb_build_object('thinned', thinned, 'forgotten', forgotten);
end;
$$;

select cron.schedule('prices-btc-usd', '5 seconds', 'call prices.fetch()');
select cron.schedule('prices-tidy', '41 * * * *', 'select prices.tidy()');


-- 4. The perp on our own price -----------------------------------------------------------------------

-- The listed perp may be on our own price (`btc-usd`); a check run's test perps keep their seeded
-- stand-in, so their liquidations repeat.
alter table perps.perps drop constraint perps_feed;
alter table perps.perps add constraint perps_feed check (
  feed = 'stand-in-btc-usd' or (listed and feed = 'btc-usd')
);
comment on column perps.perps.feed is
  'Where its price comes from: its stand-in (`stand-in-btc-usd`, PLAN.md step 3.4a), or our own '
  'Bitcoin price (`btc-usd`, prices.points: step 3.4b), the listed perp''s only. The listed perp '
  'moves from its stand-in to our own price once, and never back.';

alter table perps.rule_changes drop constraint rule_changes_rule;
alter table perps.rule_changes add constraint rule_changes_rule check (
  rule in ('created', 'stand_in', 'feed', 'trading_mode', 'max_leverage', 'taker_fee_bps',
           'taker_fee_impact', 'funding_period_ms', 'funding_sensitivity', 'max_funding_rate',
           'max_price_age_ms', 'subsidy_long', 'subsidy_short', 'funding_from', 'retired')
);

-- What never changes once a perp is made, as before, but for that one move.
create or replace function perps.guard_perp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id or new.long_account_id <> old.long_account_id
     or new.short_account_id <> old.short_account_id or new.listed <> old.listed
     or (new.feed <> old.feed
         and not (old.listed and old.feed = 'stand-in-btc-usd' and new.feed = 'btc-usd'))
     or new.stand_in_seed is distinct from old.stand_in_seed
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

-- A tick on a perp on our own price has work only once a newer price is stored than its book's.
create or replace function perps.has_work(p perps.perps, job text, at timestamptz)
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
    and (job = 'tick' or at >= perps.next_funding_at(p))
    and (job <> 'tick' or p.feed <> 'btc-usd' or exists (
           select 1 from prices.points x
           where x.feed = p.feed and (p.price_at is null or x.at > p.price_at)));
$$;

-- Where perps' prices come from, as before, and for a perp on our own price its newest stored one
-- (`point`: null before the first).
create or replace function perps.price_sources(ids uuid[])
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
      'volatility', p.stand_in_volatility::text))
    || case when p.feed = 'btc-usd' then jsonb_build_object('point', prices.latest(p.feed))
            else '{}'::jsonb end), '{}'::jsonb)
  from perps.perps p
  where (ids is null and p.state = 'live') or p.id = any (ids);
$$;

-- The start of a step, as before, and for a perp on our own price the newest stored price, which
-- the step may apply (and apply_step accepts no other).
create or replace function perps.begin_step(
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
  newest prices.points;
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

  -- On our own price, the newest stored as the step begins: the only price apply_step accepts.
  if p.feed = 'btc-usd' then
    select * into newest from prices.points x where x.feed = p.feed order by x.at desc limit 1;
  end if;
  perform set_config('perps.stepping_point', coalesce(newest.at::text, ''), true);

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
      'point', case when newest.at is null then null else prices.point_of(newest) end,
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

-- Before a trade, as before, with which price the perp is on and, on our own price, its newest
-- stored one, so the server knows when the next is due.
create or replace function perps.holdings(perp uuid, request_id uuid)
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
    'feed', p.feed,
    'point', case when p.feed = 'btc-usd' then prices.latest(p.feed) end,
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

-- A step's plan, checked and written as before; on our own price, its new price is exactly the one
-- begin_step handed over.
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

  -- 1. The new price, first: its own 5-second step, never older than the last, once. On our own
  -- price: exactly the newest stored as the step began (begin_step noted it), newer than the last.
  book_price := p.price;
  book_price_at := p.price_at;
  if priced is not null then
    new_price := perps.number(priced ->> 'price');
    new_price_at := (priced ->> 'at')::timestamptz;
    if p.feed = 'btc-usd' then
      if new_price <= 0 or new_price_at is null
         or new_price_at is distinct from
              nullif(current_setting('perps.stepping_point', true), '')::timestamptz
         or not exists (select 1 from prices.points x
                        where x.feed = p.feed and x.at = new_price_at and x.price = new_price)
         or (p.price_at is not null and new_price_at <= p.price_at) then
        raise exception 'A new price is our own, the newest stored as the step began, newer than the last'
          using errcode = 'check_violation';
      end if;
    elsif new_price <= 0 or new_price_at is null
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
  -- (at most its profit); and funding moves only from the crowded side's pool to the other. (With a
  -- new price, how the pools may balance is checked next, on its own.)
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
  ) then
    raise exception 'A move between the wrong pool and person, or more than the maths allows'
      using errcode = 'check_violation';
  end if;
  -- With a new price the pools balance one way only: Manifold moves a side's shortfall across from
  -- the other side, never both ways at once.
  if (select count(distinct m ->> 'from') from jsonb_array_elements(moves_in) m
      where m ->> 'phase' = 'price'
        and (m ->> 'from')::uuid in (p.long_account_id, p.short_account_id)
        and (m ->> 'to')::uuid in (p.long_account_id, p.short_account_id)) > 1 then
    raise exception 'With a new price, the pools balance one way only'
      using errcode = 'check_violation';
  end if;
  -- And only as Manifold's maths balances them, worked out from the positions as the new price left
  -- them (those it liquidated or settled gone, the rest at the sizes it scaled them to; nothing the
  -- trade does after counts), each side's reserve being what its positions would be paid back at
  -- the price: each one's margin, or what it's worth if less. A pool is topped up only when it holds
  -- less than its side's reserve, and never past it; the pool that pays keeps at least its own
  -- side's reserve. (Manifold moves the whole shortfall, and only when the other side has that much
  -- to spare; any move the books take here is within those bounds.)
  if exists (
    with after_price as (
      select y.direction,
             least(y.cost_basis, greatest(y.cost_basis + case y.direction
                     when 'long' then (book_price - y.entry_price) / y.entry_price
                     else (y.entry_price - book_price) / y.entry_price end
                   * (y.size + coalesce((
                       select sum((e ->> 'sizeChange')::numeric) from jsonb_array_elements(events_in) e
                       where (e ->> 'positionId')::uuid = y.id and e ->> 'phase' = 'price'), 0)), 0))
               as reserve
      from perps.positions y
      where y.perp_id = perp and y.closed_at is null
        and not exists (
          select 1 from jsonb_array_elements(events_in) e
          where (e ->> 'positionId')::uuid = y.id and e ->> 'phase' = 'price'
            and e ->> 'kind' in ('liquidation', 'settle'))
    ),
    pool as (
      select v.side, v.before,
             v.before + (
               select coalesce(sum(case when (m ->> 'to')::uuid = v.account then (m ->> 'amount')::numeric
                                        else -(m ->> 'amount')::numeric end), 0)
               from jsonb_array_elements(moves_in) m
               where m ->> 'phase' = 'price' and v.account in ((m ->> 'to')::uuid, (m ->> 'from')::uuid))
               as after,
             (select coalesce(sum(a.reserve), 0) from after_price a where a.direction = v.side) as reserve,
             exists (
               select 1 from jsonb_array_elements(moves_in) m
               where m ->> 'phase' = 'price' and (m ->> 'to')::uuid = v.account
                 and (m ->> 'from')::uuid in (p.long_account_id, p.short_account_id)) as receives,
             exists (
               select 1 from jsonb_array_elements(moves_in) m
               where m ->> 'phase' = 'price' and (m ->> 'from')::uuid = v.account
                 and (m ->> 'to')::uuid in (p.long_account_id, p.short_account_id)) as pays
      from (values ('long', p.long_account_id, pool_long_before),
                   ('short', p.short_account_id, pool_short_before)) as v (side, account, before)
    )
    select 1 from pool
    where (pool.receives and (pool.before >= pool.reserve + 0.000001
                              or pool.after > pool.reserve + 0.000001))
       or (pool.pays and pool.after < pool.reserve - 0.000001)
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
  perform set_config('perps.stepping_point', '', true);

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


-- 5. Who may call what -------------------------------------------------------------------------------
-- Nothing in schema prices is open to anyone: the perp's own functions read the stored price, and
-- only the schedule asks, as the database's owner. Its public reads come with the public API's
-- market data (PLAN.md step 3.4b, milestone 3).

revoke all on all tables in schema prices from public, anon, authenticated, service_role, hrizzup_app;
revoke all on all routines in schema prices from public, anon, authenticated, service_role, hrizzup_app;
