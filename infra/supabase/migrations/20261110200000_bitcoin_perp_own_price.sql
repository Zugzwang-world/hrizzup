-- The Bitcoin perp onto our own price (PLAN.md step 3.4b, milestone 3 of 3): the listed perp moves
-- from its stand-in to our own Bitcoin price (`btc-usd`: prices.points, made by
-- 20261110191500_bitcoin_price.sql), once and for good, in every environment, and the move is in its
-- rule-change log. The website reads our own price for it since milestone 2, so nothing on staging
-- waits for this but the price itself.
--
-- - On staging, where the perp is switched on and its jobs are set up, the price is asked for from
--   the schedule's next run, a few seconds after this; until the first is stored, the perp's reads
--   answer "not set up" and a trade waits for it. The first stored price is applied like any new one:
--   the book's last stand-in price moves to Bitcoin's, liquidating any position it reaches.
-- - Production's perp is off, and its jobs aren't set up, so production asks nothing (P.18 in the
--   runbook's pre-launch checklist switches it on, on this price).
-- - A check's fresh database and this Mac's: the perp is off, with no jobs set up, so nothing is
--   ever asked there.
-- - Its other rules, Manifold's `maxPriceAgeMs` among them, stay as they were.

with moved as (
  update perps.perps p
  set feed = 'btc-usd',
      updated_at = greatest(date_trunc('milliseconds', clock_timestamp()), p.updated_at)
  where p.listed and p.feed = 'stand-in-btc-usd'
  returning p.id, p.updated_at
)
insert into perps.rule_changes (perp_id, at, by_account, rule, old_value, new_value, reason)
select moved.id, moved.updated_at, null, 'feed', 'stand-in-btc-usd', 'btc-usd',
       'Our own Bitcoin price replaces the stand-in: every 5 seconds, the median of Coinbase, Kraken '
       || 'and Bitstamp, Gemini standing by (PLAN.md step 3.4b; the Product chat, 10 November 2026)'
from moved;
