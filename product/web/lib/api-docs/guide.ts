import { DEFAULT_PAGE, MOST_A_PAGE } from '@hrizzup/api';
import { server } from './reference.ts';

/**
 * The public API's guides (PLAN.md step 3.5a): what the demo promises, how a bot makes its first
 * call, the ground rules, moving from Manifold, and AI tools. Written once, shown on the docs page
 * (app/docs) and in llms-full.txt, so the two always say the same. Text marks code with backticks.
 */

export type Block =
  | { kind: 'p'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'code'; text: string }
  | { kind: 'table'; head: string[]; rows: string[][] };

export type Section = { id: string; title: string; blocks: Block[] };

/** The guides the docs page itself shows; each other guide has a page of its own (/docs/<id>). */
export const OVERVIEW: ReadonlySet<string> = new Set(['demo', 'first-call']);

const p = (text: string): Block => ({ kind: 'p', text });
const list = (...items: string[]): Block => ({ kind: 'list', items });
const code = (text: string): Block => ({ kind: 'code', text });

/** The site the API is on: staging, the demo. */
export const site = server.replace(/\/api\/v1$/, '');

export const guide: Section[] = [
  {
    id: 'demo',
    title: 'The demo',
    blocks: [
      p(
        "Hrizzup's API is the one Hrizzup's own website and app use: play-money prediction markets and a Bitcoin perp. Until launch it runs only on staging, the demo, which promises three things:",
      ),
      list(
        '**Play money only.** Every account starts with Ṁ1,000 of play money; nothing here is worth anything.',
        '**Keys that work only here.** A key starts `hz_demo_` and works on staging alone; production refuses it.',
        '**Data that may be reset.** Markets, balances and keys may be reset, with notice in the changelog first.',
      ),
      p('Production opens its own API at launch, with keys of its own.'),
    ],
  },
  {
    id: 'first-call',
    title: 'Your first call',
    blocks: [
      p('Public reads need no key. The markets, newest first, five to a page:'),
      code(`curl "${server}/markets?limit=5"`),
      p(
        `For your own play money, make a key: sign in at ${site}/sign-in-test, then open ${site}/sandbox/keys and make a read-only key (your balance, positions and orders) or a trading key (those, and trading and the perp). It's shown once: keep it secret, like a password. Then send it as \`Authorization: Bearer\` and the key:`,
      ),
      code(
        `export HRIZZUP_KEY=hz_demo_...   # yours, shown once\ncurl -H "Authorization: Bearer $HRIZZUP_KEY" "${server}/me/positions"`,
      ),
      p(
        'With a trading key, buy Ṁ10 of Yes in a market. Each trade carries a request ID of your own (a new UUID); send the same one again on a retry, and it never trades twice:',
      ),
      code(
        `curl -X POST "${server}/trades" \\\n  -H "Authorization: Bearer $HRIZZUP_KEY" -H "Content-Type: application/json" \\\n  -d '{"marketId": "<a market's id>", "requestId": "'"$(uuidgen | tr A-Z a-z)"'", "action": "buy", "outcome": "yes", "amount": "10"}'`,
      ),
      p(
        'Revoke a key on the same page whenever you like: it stops working at once. You can hold five live keys at a time, and make ten an hour.',
      ),
    ],
  },
  {
    id: 'rules',
    title: 'The ground rules',
    blocks: [
      list(
        "**Keys:** `Authorization: Bearer <key>`; Manifold's `Authorization: Key <key>` works too. A read-only key is refused a trade (403). Keys are made and revoked only on the keys page, signed in: no key can make another.",
        "**Public reads need no key,** and are kept at the edge for a few seconds. Send them no key: a request with an `Authorization` header is never answered from the edge's copy.",
        '**Amounts are exact decimal text** (`"25"`, `"2.5"`, to six decimal places), never JSON numbers, because the books are exact. Probabilities are text too (`"0.42"`). Times are ISO 8601, in UTC.',
        `**One way to page:** every list takes \`limit\` (1 to ${MOST_A_PAGE}, ${DEFAULT_PAGE} when not sent) and \`cursor\`, the \`next\` of the page before, sent back exactly as it came. \`next\` is null on the last page. A cursor is opaque: never build one.`,
        '**One error format:** every refusal is `{ "defined": true, "code": "REFUSED", "status": 422, "message": "…", "data": { … } }`. A refused input is 400 `BAD_REQUEST`, with each problem in `data.issues` (its field\'s path and what\'s wrong); a refused trade is 422 `REFUSED`, with its `data.reason`.',
        '**Limits:** 60 requests a minute from each address, 120 personal reads a minute for each key, and 30 trades a minute for each account. Past one: 429, with `Retry-After` in seconds. The `RateLimit-Policy` and `RateLimit` headers say how much is left.',
        '**Retries:** a trade with a request ID already answered gets its first answer back, whatever has changed since. Safe to retry on a timeout.',
        "**No one's name in public data:** public reads show markets, prices and amounts, never who traded.",
        "**Versioning:** the version is in the address (`/api/v1`). Within v1, only additions: new calls, new optional inputs, new fields. Ignore any field you don't know. Anything else comes as v2, beside v1.",
      ),
    ],
  },
  {
    id: 'market-data',
    title: 'Markets, quotes and prices',
    blocks: [
      p(
        "Everything a market page shows is a public read: no key, the same answer for everyone, and never anyone's name. Each is kept at the edge a moment and cleared the moment a trade changes it.",
      ),
      list(
        "**One market:** `GET /markets/{id}`, any that isn't a draft, with its `probability` of Yes now.",
        '**Its history:** `GET /markets/{id}/history?range=1d`, the probability after each trade over the last hour (`1h`), day (`1d`), week (`1w`), 30 days (`1m`) or everything (`all`, when not sent), starting with the probability as the range starts. At most 1,000 points: over a busier range, the last of each of 1,000 equal slices.',
        "**Its resting limit orders, by price:** `GET /markets/{id}/book`. There's no central order book: a trade fills against the market's pool and any resting orders it reaches. Each side best first, with what's unfilled at each price and how many orders hold it, beside the pool's `probability`.",
        '**Its latest trades:** `GET /markets/{id}/trades`, newest first, each buy or sale as it was placed (`amount` paid, below zero when received; `shares` got, below zero when sold), paged like every list.',
        '**A quote for any size:** `GET /markets/{id}/quote?outcome=yes&amount=100` for a buy (add `limitProb` for a limit order), or `?action=sell&outcome=yes&shares=40` for a sale: the shares, the average price, the probability before and after (`probBefore`, `probAfter`) and the payout, worked out by the same maths a trade runs, writing nothing. A trade sent next with the same figures fills exactly as quoted, to the millionth, unless another trade comes first.',
        "**The perp's quote:** `GET /perps/{id}/quote?direction=long&margin=100&leverage=5`: its size, fee and liquidation price at the price now. An order fills at the next price, a few seconds on, so those move with it.",
        "**Our own Bitcoin price:** `GET /prices/btc-usd`, a new one about every 5 seconds: the median of Coinbase's, Kraken's and Bitstamp's free public prices (Gemini standing by), to the cent, with how many exchanges made it (`sources`; 0 while the last price is held, for up to 30 seconds). Its history: `GET /prices/btc-usd/history?range=1h`, the last day when not sent. The website, the app, every bot and the perp use this one price.",
      ),
      p(
        "There's no live stream yet: ask again. The price changes about every 5 seconds, so asking more often than that gets the same answer from the edge; a market's reads change only when someone trades.",
      ),
      code(
        `curl "${server}/prices/btc-usd"\ncurl "${server}/markets/<a market's id>/quote?outcome=yes&amount=100"`,
      ),
    ],
  },
  {
    id: 'trading',
    title: 'Trading for bots',
    blocks: [
      p(
        'With a trading key, a bot trades as the account that made it. Every trade carries a request ID of its own (a new UUID): send the same one again on a retry, and the books answer what they did the first time, never trading twice.',
      ),
      list(
        '**Buy or sell:** `POST /trades` with `"action": "buy"` and an `amount` of play money, or `"action": "sell"` and `shares`. A buy with `limitProb` is a limit order: it buys only while the probability of Yes is at most that (a Yes order) or at least it (a No order), resting until later trades reach it, and `expiresAt` ends it. `outcome` is `yes` or `no`; Manifold\'s `YES` and `NO` work too.',
        '**A dry run:** add `"dryRun": true` (Manifold\'s name). The trade is worked out exactly as the books would do it, your own balance, position and resting orders included, then undone: nothing moves. The answer is the trade\'s, marked `dryRun`, with the nil UUID as its trade ID; the same request ID then works for the real trade. A request ID already used is refused (409). For a quote without a key, ask `GET /markets/{id}/quote`.',
        "**Cancel a resting order:** `POST /orders/cancel` with the market, the order's ID (the trade ID its answer gave) and a request ID.",
        "**The perp:** `POST /perps/open` with a `direction` (`long` or `short`), a `margin` and a `leverage` (up to 10 times); `POST /perps/close` with a `fraction`: `1` for all of it, or a share such as `0.5` with `expectedSize`, the position's size you saw, so a position that has changed since isn't cut by the wrong amount (Manifold's rule). Each fills at the next price, a few seconds on, and answers then.",
        '**Your portfolio:** `GET /me/positions` (your balance and positions), `GET /me/orders` (your resting orders), `GET /me/perps` (your perp positions, valued at the price now) and `GET /me/trades` (your own trades, newest first, each with `isApi` saying whether a key placed it). A read-only key reads these too.',
      ),
      p(
        "The example bot does all of it in one small file, `examples/bot/bot.ts` in the repository (github.com/Zugzwang-world/hrizzup), with your key from the environment. From the repository's folder, with Node.js 24 or later:",
      ),
      code(
        'read -rs HRIZZUP_API_KEY && export HRIZZUP_API_KEY   # paste your trading key, then Return\nnode examples/bot/bot.ts',
      ),
    ],
  },
  {
    id: 'manifold',
    title: 'Moving from Manifold',
    blocks: [
      p(
        "Hrizzup's markets run on Manifold's open-source maths, and the API keeps Manifold's field names wherever ours mean the same: `outcome`, `amount`, `shares`, `limitProb`, `expiresAt`, `probBefore`, `probAfter`, `orderAmount`. Four differences, on purpose:",
      ),
      {
        kind: 'table',
        head: ['Manifold', 'Hrizzup', 'Why'],
        rows: [
          ['`contractId`', '`marketId`', 'Ours are markets'],
          [
            '`"YES"`, `"NO"`',
            '`"yes"`, `"no"` (`"YES"`, `"NO"` taken too)',
            'Lower case, like every value of ours',
          ],
          [
            'milliseconds (`createdTime`)',
            'ISO 8601 times (`createdAt`)',
            'Readable, and no time zones to guess',
          ],
          ['numbers (`10`)', 'decimal text (`"10"`)', 'The books are exact to the millionth'],
        ],
      },
      {
        kind: 'table',
        head: ['Manifold', 'Hrizzup'],
        rows: [
          ['`GET /v0/me`', '`GET /me`'],
          ['`GET /v0/markets`', '`GET /markets`'],
          ['`GET /v0/market/{id}`', '`GET /markets/{id}`'],
          ['`GET /v0/bets?contractId=…`', '`GET /markets/{id}/trades` (no names)'],
          ['`GET /v0/bets?kinds=open-limit`', '`GET /markets/{id}/book` (no names)'],
          ['`POST /v0/bet`', '`POST /trades`, `"action": "buy"`, with a `requestId` of your own'],
          [
            '`POST /v0/bet` with `dryRun`',
            '`POST /trades` with `dryRun`, or `GET /markets/{id}/quote`',
          ],
          ['`GET /v0/bets?userId=…` (your own)', '`GET /me/trades`'],
          ['`POST /v0/market/{id}/sell`', '`POST /trades`, `"action": "sell"`'],
          ['`POST /v0/bet/cancel/{id}`', '`POST /orders/cancel`'],
          ['`before` (paging)', '`cursor`, the `next` of the page before'],
        ],
      },
    ],
  },
  {
    id: 'ai-tools',
    title: 'For AI tools',
    blocks: [
      list(
        `**llms.txt:** ${site}/llms.txt, the short guide for AI tools, in the llmstxt.org format.`,
        `**The docs as text, every guide and call:** ${site}/llms-full.txt.`,
        `**The OpenAPI file:** ${server}/openapi.json (OpenAPI 3.1), made from the same contract the website and the app use; any OpenAPI tool reads it.`,
      ),
      p(
        'Give your AI tool a key of its own, read-only unless it should trade, and revoke it when you are done.',
      ),
    ],
  },
  {
    id: 'changelog',
    title: 'Changelog',
    blocks: [
      p('Every change to v1 and every reset of the demo is listed here first, newest at the top.'),
      list(
        "**11 November 2026, evening:** trading for bots: `dryRun` on `POST /trades`, Manifold's `YES` and `NO` taken as `outcome`, and your own trades at `GET /me/trades`; the example bot. Only additions.",
        "**11 November 2026, later:** a market's own reads (`GET /markets/{id}`, its history, its resting orders by price, its latest trades and a quote for any size), the perp's quote, and our own Bitcoin price and its history. Only additions.",
        '**11 November 2026:** v1 opens on staging, the demo: the markets and the perp, personal keys (read-only or trading), `limit` and `cursor` on every list (renamed from `after`), one error format, and this page.',
      ),
    ],
  },
];
