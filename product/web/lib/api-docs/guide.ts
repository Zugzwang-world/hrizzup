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
          ['`"YES"`, `"NO"`', '`"yes"`, `"no"`', 'Lower case, like every value of ours'],
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
          ['`POST /v0/bet`', '`POST /trades`, `"action": "buy"`'],
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
        '**11 November 2026:** v1 opens on staging, the demo: the markets and the perp, personal keys (read-only or trading), `limit` and `cursor` on every list (renamed from `after`), one error format, and this page.',
      ),
    ],
  },
];
