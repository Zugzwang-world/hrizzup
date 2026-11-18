# Every time the API prints has three decimals

> Round 6, relay R16, milestone M2, 18 November 2026: the expert's design, for the builder. Design only: no code, test or setting changed here. The founder's ask (18 November 2026): every time the public API prints has exactly three decimals, done in the smallest safe place, with a test across every call that prints a time; existing v1 calls keep their shapes.

**In short:** one printer in the API's one output layer, the middleware every call already passes through (`product/web/lib/api/base.ts`). It finds the times by the call's own output schema (never by how a string looks) and rewrites each one, as text, to exactly three decimals, cutting any digits past the third (never rounding). The contract, the inputs, `openapi.json` and the database stay exactly as they are. Social's calls were left out until social adopted it (done on 18 November 2026, R5's M7: see the end). `[normal]`, one pull request, no migration.

## 1. What is true today (checked, not assumed)

- **The middleware sees the validated answer and its rewrite reaches every caller.** oRPC 1.16.1 runs output validation inside `next()` for every procedure built from `api` (`outputValidationIndex` is 1 for `api`'s calls and 2 for `admin`'s), so `base.ts` receives what passed `z.iso.datetime()`, and what it returns is sent without being validated again. Tried in a scratch run: the middleware saw the answer with unknown keys already stripped, and its change reached a `createRouterClient` caller. The website's route (`app/api/v1/[[...rest]]/route.ts`), the MCP server (`lib/mcp/server.ts:174`) and `serverApi` (`lib/api/server.ts:10`) all call the same `router`, whose every handler comes from `api` or `admin` (`router.ts`, `lib/api/social/*.ts`).
- **A `z.custom` value passes through by reference** (same scratch run): the agreement's market record inside `markets.list` and `markets.get` reaches the middleware as the handler's own object. Rewriting it in place would change the caller's object, such as a test's shared example.
- **Zod 4.6.7's `z.iso.datetime()`** accepts only `YYYY-MM-DDTHH:MM:SS`, then an optional `.` with one or more digits, then `Z`. Its `_zod.def` is `{ type: 'string', format: 'datetime', offset: false, local: false }`, and `.refine()` and `.nullable()` keep that. The older `z.string().datetime()` keeps the format in `def.checks`, not `def.format`.
- **V8 cuts, never rounds:** `new Date('…12.999999Z').toISOString()` is `…12.999Z`, the same as cutting the text, and Postgres's `date_trunc('milliseconds')` cuts too.
- **oRPC documents a `z.codec` as its output side** (`{type: string, format: date-time}`, still required), but a `.transform()` as `{}`, dropped from `required`, which oasdiff would count as breaking.
- **The derived list today** (walking every call's output schema): 18 published calls print a time (`health`, `markets.list/get/history/trades/quote/trade`, `perps.list/get/quote/open/close`, `prices.get/history`, `portfolio.positions/perps/trades/orders`), plus `keys.list/create/revoke` and the 12 calls under `admin.markets` and `admin.perps`. No error's `data` holds a time. No output holds a time under a union, record, tuple or lazy schema. The only `z.custom` in any output is `marketRecord`. Social's 63 calls that print times hold none in a cursor field (their cursors are opaque text).
- **Where the scout's map differs:** `examples.ts` feeds neither `openapi.json` (its only time is the agreement's title "like 2026-11-05T09:30:00Z") nor the docs; it feeds the stand-in and tests only. `trading.test.ts:316,329` already expects `.000Z` through the route. The other pins (`keys.test.ts:161,210`, `markets/src/console.test.ts`, `data.db.test.ts:156-158`, social's `brief` and `cursor` tests) call package functions below the output layer, so they stay as they are.

## 2. The decision

1. **Where:** the `base.ts` middleware calls one printer, `printTimes(outputSchema, output)`, from a new `product/packages/api/src/times.ts`. Every call outside social is printed: the published ones and MCP, `keys.*` and `admin.*`. The printer lives in the contract's package, so the database tests can apply it to real answers.
2. **How times are found:** by the output schema only. A time is a Zod string whose format is `datetime`, or one of the five time fields of the agreement's market record (derived from the agreement's own definition). Free text never changes, even if it reads like a time.
3. **How a time is printed:** as text. Pad the fraction to three digits, or cut it at three (`…30Z` becomes `…30.000Z`, `….3Z` becomes `….300Z`, `….123456Z` becomes `….123Z`). Never rounded: rounding could carry a time into the next second, day or year, and print a moment later than the one stored. Cutting matches `toISOString()` and `date_trunc`, and on social's check-in it can only re-show, never skip.
4. **Contract and docs:** nothing in the contract changes, so `openapi.json` stays byte-for-byte the same, oasdiff sees no difference, and inputs keep taking 0 to 6 decimals. The guide and the MCP instructions say "three decimals". The OpenAPI description does not, to keep the file unchanged.
5. **Examples:** every example *answer* of a non-social call moves to three decimals, because the examples are what the API answers. Agreement-derived records are printed in code; `agreement/examples/` is never edited.

## 3. Rejected alternatives

- **Change `markets.utc` to print milliseconds:** social's cursors cast its text back and page by `(t, id) < (after_t, after_i)` (`social.sql:2028-2040, 2301`), so cutting would skip rows. Its replay fingerprints hold `markets.utc` text (`social.sql:1906`), so a retry across the change would get a 409.
- **A new `markets.utc_ms` across the ~92 non-social call sites:** a `[risky]` rewrite of trading and perp function bodies, two pull requests, and replies stored before it would still print the old way.
- **Output codecs in the contract (`z.codec`):** dozens of output sites across six files would need splitting from the shared `moment`, which inputs also use; putting a codec on `moment` itself would rewrite inputs too and empty `toTheMillisecond` of meaning. `marketRecord` can't be reached without wrapping it (`openapi.ts` registers it by reference), and a site that is missed stays raw without anyone noticing.
- **oRPC's serializer or handler interceptors:** a serializer sees types, not schema positions, and MCP and `serverApi` never pass through the OpenAPI handler.
- **Matching any string that looks like a time:** it would rewrite free text, which the founder's rule forbids.
- **`toISOString()` in each package function:** about 15 places to remember, which is how today's mix of forms came about.

## 4. Rules for the builder

1. **New `product/packages/api/src/times.ts`**, exported from `src/index.ts` (the app imports only `@hrizzup/api/client`, so nothing reaches it). It exports:
   - `PRINTED_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/`;
   - `printedTime(time)`;
   - `timePlan(schema)`, returning `{ paths, unknown }`;
   - `mapTimes(schema, value, fn)`;
   - `printTimes(schema, value)`, which is `mapTimes` with `printedTime`;
   - `timesIn(schema, value)`, returning `{ path, time }[]`.
2. **`printedTime`:** match `^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$`, then return `` `${head}.${(fraction ?? '').padEnd(3, '0').slice(0, 3)}Z` ``. Text that doesn't match comes back unchanged, which can't happen after validation. Never parse with `Date`.
3. **`timePlan`, compiled once for each schema object (a `WeakMap`), from `schema._zod.def.type`:**
   - `string` is a time when `def.format === 'datetime'` or a check in `def.checks` has that format. A datetime that allows offsets or local times (`offset` or `local` true) goes to `unknown`, because it needs converting to UTC, not reprinting.
   - `object` looks at every key of `def.shape`. A catchall that holds a time goes to `unknown`.
   - `array` looks at `def.element`.
   - `optional`, `nullable`, `default`, `prefault`, `readonly`, `nonoptional` and `catch` look at `def.innerType`.
   - `custom` is `marketRecord` only. Its times are the top-level properties of `shapes['market/1']` whose `$ref` is exactly `common.schema.json#/$defs/time`. A time `$ref` deeper in that definition, or any other custom, goes to `unknown`.
   - `union`, `record`, `tuple`, `intersection` and `pipe` have no times when nothing inside them has any. If something does, they go to `unknown`.
   - Leaves such as number, boolean, enum, literal, null and date have no times.
   - `lazy`, `any`, `unknown`, `transform` and every other kind go to `unknown`.
   - Paths read like `markets[].market.opens_at`.
4. **At run time, `mapTimes` never throws and never changes its input.**
   - A plan with no times returns the value itself.
   - An object is copied once (`{ ...value }`), and only keys it already has (`Object.hasOwn`) are set. Key order stays the same.
   - An array is mapped.
   - `null`, `undefined` and anything of the wrong kind come back as they are.
   - A time leaf goes through `fn` only when it is a string.
   - Parts that are `unknown` are left alone. The tests make sure `unknown` stays empty.
5. **`product/web/lib/api/base.ts`:**
   - Name the middleware and export it as `everyCall`, so a test can find it on every procedure.
   - Inside its `try`, after `next()` and the headers, return `isSocialCall(path) ? result : { ...result, output: printTimes(procedure['~orpc'].outputSchema, result.output) }`.
   - Change nothing else.
6. **Keep the six `toISOString()` sites** (`markets/src/trading.ts:149`, `data.ts:32`, `perps/src/data.ts:54`, `trading.ts:147`, `router.ts:116`, `keys.ts:304`). They run before validation and turn the `+00:00` forms that the contract refuses into `Z` forms.
7. **`product/packages/api/src/examples.ts`:**
   - Every time in an exported answer of a non-social call is written with three decimals.
   - `consoleMarketWithLog`, `consoleMarket`, `marketList` and `oneMarket` print the fields they take from the agreement's example with `printedTime` (or `printTimes`).
   - Inputs and social's examples stay as they are.
   - Free text keeps the database's own form. In `consolePerpWithLog`, `perpMadeAt` (`'2026-11-10T10:30:00Z'`) feeds the log's `funding_from` `newValue`, which the database writes with `markets.utc`, so it stays as it is; the `stand_in` line's text keeps its time too. The time fields (`fundingFrom`, `createdAt`, `updatedAt` and the log's `at`) take `printedTime(perpMadeAt)`.
   - Tests that compared those fields with the agreement's raw example now compare with `printedTime(raw)`. That changes the expected value, not the test's strength.
   - In any test that goes through the route or MCP, a mock's database row keeps its raw form and the expected answer takes the printed form. A grep found no such raw expectation outside the examples: `trading.test.ts:316,329` already expects `.000Z`, and the other raw times are mock rows or inputs.
8. **Docs:**
   - In `product/web/lib/api-docs/guide.ts`, the ground rule becomes "Times are ISO 8601, in UTC, always with three decimals (`2026-11-09T06:30:00.000Z`); a time you send may have none to six."
   - Add a changelog line, dated the day it merges, saying "only the format of times already there".
   - The same clause goes into `INSTRUCTIONS` in `lib/mcp/server.ts`.
   - Leave the `DESCRIPTION` in `openapi.ts`, and `openapi.json`, untouched.
9. **Nothing else:** no migration, no Redis key, and no change to `agreement/`.

## 5. Edge cases

| Case | What must happen |
|---|---|
| `…30Z`, `….3Z`, `….12Z` | `….000Z`, `….300Z`, `….120Z` |
| `…59.9999Z` on 31 December | `…59.999Z`: the same second and the same year |
| Null or absent optional time | Stays null or absent; no key is added |
| Free text that reads like a time (question, rules, source name, cursor `next`, the perp log's `oldValue`/`newValue` for `funding_from`) | Unchanged |
| The market record | Its five times are printed; it still passes the agreement's `validate()` |
| A retry (`markets.requests.result`, `perps.requests.result`) | Printed exactly as its first answer; a retry across the deploy shows the same moment, now with three decimals |
| Copies kept at the edge before the deploy | They expire within their windows (at most 60 + 300 seconds); no purge, since both forms are valid |
| Inputs | Unchanged: 0 to 6 decimals; the perp's `origin` still at most 3 |
| A printed time | Up to 0.999 ms earlier than the one stored, never later |
| Social, the live `admin.social` calls included | Unchanged in this milestone (they joined on 18 November 2026, R5's M7) |
| `/api/health` (outside v1) | Already `toISOString()`; untouched |

## 6. Tests that must exist

**A. Unit tests, no database: `product/packages/api/src/times.test.ts` (Vitest, in Quick checks).**

1. **`printedTime`:** the cases in the table above, the same answer as `new Date(x).toISOString()` for 0 to 9 digits, printing twice changes nothing, and text that doesn't match comes back unchanged.
2. **Every output is understood:** for every call in `procedures(contract)`, social included, `timePlan(output).unknown` is empty, and no error's `data` schema holds a time.
3. **Pinned members, so the derived list can never come back empty:**
   - `health` has `checkedAt`;
   - `markets.get` has the five `market.*` times, and those equal the agreement's time `$ref`s;
   - `portfolio.orders` has `orders[].expiresAt` and `orders[].createdAt`;
   - `admin.perps.get` has `standIn.origin` and `log[].at`.
4. **Every call in the derived list (non-social calls with times):** a map from call to example answer, whose keys must equal the derived list, so a new call can't be missed. For each call:
   - the example is already printed, each of its times matches `PRINTED_TIME`, and there is at least one;
   - with database forms planted at every path (`mapTimes`, cycling `…30Z`, `….3Z` and `….123456Z`), each printed time equals the expected one;
   - masking the times on both sides leaves the printed answer and the planted one deep-equal, which proves nothing else changed;
   - the printed answer passes the output schema, and printing it twice changes nothing;
   - the deep-frozen planted value is untouched;
   - a scan of the JSON finds no other time that looks like ISO, except in a named list of free-text fields, today only the perp log's `log[].oldValue` and `log[].newValue`.
5. **Free text stays:** a `listedMarket` with time-like text in its question, rules and `next` keeps it, and a `ruleChange` with a time in `newValue` keeps it.
6. **Real database coverage:** every published call in the derived list except `health` appears in some `product/packages/*/src/*.db.test.ts`. Match `contract\.<call>\b` with a word boundary, so that `contract.markets.trades` doesn't count for `markets.trade`.

**B. The website, no database, mocked like `market-data.test.ts`: a new `product/web/app/api/v1/[[...rest]]/times.test.ts`.**

1. Every procedure in `router` has `everyCall` first, exactly once, with `outputValidationIndex` of 1 or more.
2. Over HTTP, with mocks returning database forms:
   - `GET /markets/{id}` (record times in all three forms, and a question holding `2026-12-31T00:00:00Z`) prints every time, and the question is byte-identical;
   - `/me/orders` and `/me/keys` handle a null time and a raw one;
   - `/health` prints `checkedAt`.
3. In `lib/mcp/server.test.ts`, `markets_get` on the same record prints its times in both `structuredContent` and the text.
4. In `lib/api/social/admin.test.ts`, a live social console call keeps a raw `….3Z`.

**C. Real answers: `pnpm test:db`, in the Database check (needs the slot's database).**

1. The four `passes` helpers (`markets/src/data.db.test.ts:84`, `markets/src/trading.db.test.ts:116`, `perps/src/data.db.test.ts:102`, `perps/src/steps.db.test.ts:248`) also check, for the printed answer:
   - every time in `timesIn` matches `PRINTED_TIME` and equals `toISOString()` of its raw value at the same path;
   - it passes the schema;
   - printing it twice changes nothing;
   - a JSON scan finds no other time that looks like ISO, with the same exemptions as A.4.

   This covers 16 of the 17 database-backed calls already.
2. Add `markets.quote` to `data.db.test.ts`.
3. Retries of `markets.trade` and `perps.open` with the same `requestId` print exactly as their first answers.
4. Each fixture creates at least one market with `closesAt` in whole seconds and one with one decimal.

## 7. Size, pull requests, and what's left open

- **`[normal]`, one pull request.** It is an output format with no money arithmetic, no database structure and no sign-in. The relay's reviewer sees it before it opens. `@hrizzup/api` sits upstream of every package, so its tests run everywhere.
- **For the Product brief's open questions:** should social's calls print three decimals too?
  - **Recommendation:** yes, in social's own next milestone, before its public beta: remove the `isSocialCall` exception and print its examples.
  - **Done on 18 November 2026 (R5's M7, the founder's decision):** social's calls joined, with no database change: the exception in `base.ts` is gone, social's examples are printed, and the tests that pinned social's raw times pin three decimals. The check-in's `asOf` is cut, never rounded, so `seenUntil` is at most a millisecond early.
  - **From what was checked, no database change is needed:** no social output holds a time in a cursor, and its replay fingerprints are built from what was sent.
  - **Two times can come back from a client:** the check-in's `asOf`, sent back as `seenUntil`, and the social console's saved records. A walk of every input found no others. `checkin_done` only moves the mark forward, so a cut `asOf` can only re-show what arrived in its last millisecond, never skip it; social's milestone confirms the console's records.
  - **Confirmed on 18 November 2026 (R5's M7):** `admin.social.stories.save` and `admin.social.updates.save` take an agreement record the caller builds, and no console answer holds a record or a time that a client sends back; the console's forms write their own times (`toISOString()`, three decimals).
- **For the founder:** nothing.
