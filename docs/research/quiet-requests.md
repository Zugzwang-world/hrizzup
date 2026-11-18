# Every journey's request goes through the quiet wrapper

> Round 6, relay R16, milestone M5, 18 November 2026: the expert's design, for the builder. Design only: no code, test or setting changed here. The founder's done-test (18 November 2026): "every journey's requests go through `product/web/e2e/support/quiet-request.ts` (R6's finding in the status file), changing no test's assertion, with a proof that a failing request prints only its method and path, never a header."

**In short:** one new function, `quiet(context)`, gives any Playwright request context the same seven sending methods, taking the same arguments, whose failures name only `METHOD /path`; its answers are read the way Playwright's are (`status()`, `headers()`, `text()`, `json()`). Each raw call becomes `quiet(x).get(…)` (and `route.fetch(…)` becomes `quietRoute(route).fetch(…)`), `books.ts`'s `call` becomes R6's quiet `call`, and the three local copies of `fetchThrough` become R6's. A Vitest guard reads every e2e file with TypeScript's type checker and fails on any sending method used on a Playwright `APIRequestContext` or `Route` outside the wrapper. A proof drives a real request context (no browser) against a closed local port.

`E` below is `product/web/e2e`.

## 1. What is true today (checked, not assumed)

- **Where the headers come from.** Playwright 1.64.1's request client logs `→ METHOD fullurl` and then every header as `name: value` (`playwright-core/lib/coreBundle.js:28113-28117`). The client appends that log to the message of any call that fails (`formatCallLog`, `:65240`, used at `:65449`), and the error also keeps it as `error.log`. **A scratch Vitest run** used Node 24.21, Vitest 5.0.5 and a real `request.newContext()`, with a made-up `Authorization` in `extraHTTPHeaders` and a made-up cookie in `storageState`:
  - a closed port gave `apiRequestContext.get: connect ECONNREFUSED…`, and a 300 ms timeout gave `…Timeout 300ms exceeded.`; both had a `Call log:` holding the key and the cookie;
  - the same calls through a prototype of `quiet()` gave only `GET /api/v1/x got no answer`, with no cause and no `log`; neither value appeared in the message, the stack, `String(error)` or `util.inspect(error, { showHidden: true })`;
  - no browser was started: no `spawn`, `fork` or `execFile`. The only child process was an `execSync` of `sw_vers`, which Playwright runs on a Mac to build its user agent.
- **Every context carries a credential.** Playwright's runner copies the project's `use` options into every request context made inside a test (`runBeforeCreateRequestContext`, `playwright/lib/index.js:128`). So the `request` fixture and every `playwright.request.newContext()` start with the project's `storageState`, which holds the deployment's bypass cookie (`_vercel_jwt`) on a preview. A "signed-out" call's failure therefore prints a credential too. `page.request` and `context.request` carry the browser's cookies, sessions included.
- **`route.fetch` is the same request.** `Route.fetch` calls `context.request._innerFetch` (`coreBundle.js:61241`), so its failure carries the same call log, with the browser context's cookies.
- **Reading an answer can't print the headers.** `body()`, `text()`, `json()` and `dispose()` go through `fetchResponseBody` and `disposeAPIResponse`, which log nothing (`:56526-56534`). In the scratch run, `text()` after its context was disposed gave `Response has been disposed`, with no call log. They are still read through the guard, as R5 and R6 do, so there is one rule.
- **`expect(response).toBeOK()` prints the log.** On a failure it fetches the stored log (`response._fetchLog()`, `playwright/lib/matchers/expect.js:12961`) and prints it, with the first 1,000 characters of the body. No e2e file uses it today.
- **A test's timeout reports the cut-off request too.** The test body's later rejection still reaches `_failWithError` (`worker/workerProcessEntry.js:1130-1149`). So a raw request cut off by a timeout prints its headers; a quiet one turns that rejection into the quiet error.
- **The reporters print a test's own errors only:** message, stack, snippet and cause (`runner/index.js:1491-1520`), never a Playwright step's error. Traces, screenshots and video are off (`product/web/playwright.config.ts:40-42`). The Screen check uploads only its parts' records and the screenshots, and a part's record holds its part number, test names and passed tests' seconds, nothing else (`E/support/parts.ts:74-96`). A failure's message is the only way a header reaches a public log.
- **Node's `fetch` and supabase-js never print a header on a failure** (scratch probes):
  - undici's refused, hung-up and timed-out requests say `fetch failed`, with a cause that names only the address;
  - supabase-js 2.110's `generateLink`, `verifyOtp`, `from().select()` and `rpc()` wrap that message only;
  - undici quotes a header only when it refuses the value before sending it (a new line or a NUL inside: `Headers.append: "…" is an invalid header value`). No key, token or cookie our services make can contain one, and a Doppler value such as the bypass secret `support/bypass.ts` sends is masked in GitHub's logs anyway.
- **No call answers 202.** There is no `successStatus: 202` in the contract (`product/packages/api/src`), and no 202 in `product/web/lib/`, `product/web/app/` or `examples/`. Rule 14 relies on this.
- **A new journey re-runs the guard.** Turbo's `test` task has no `inputs` (`turbo.json`, on `main` too), so every tracked file of the package, the e2e specs included, is in its hash. A new or changed journey can't replay a cached pass.
- **The scan is cheap.** TypeScript 6.0.3's checker over the 91 e2e files (1,160 source files with their imports) built in about a second on this Mac. A scratch scan with rules 17 and 18 exactly as written (any use of a method, element access, bindings, union members, the nearest function) found every raw send:
  - 25 sends outside the wrapper (listed next);
  - 6 inside R5's and R6's `quietly(…)` or `answerOf(…)` callbacks: `support/social-calls.ts:62`, `journeys/social-board-pages.spec.ts:62,214`, `journeys/social-board.spec.ts:51,63` and `journeys/social-join.spec.ts:207`;
  - 2 in `quiet-request.ts` itself.

**The 25 raw sends:**

| File | Lines |
|---|---|
| `E/support/books.ts` | 37 |
| `E/journeys/api.spec.ts` | 23, 34, 42, 52, 76 |
| `app-sign-in.spec.ts` | 60, 98, 119 |
| `sign-in.spec.ts` | 154 (`route.fetch`), 172, 194, 275 |
| `console-api.spec.ts` | 59 |
| `perp-console.spec.ts` | 89 |
| `console.spec.ts` | 100 |
| `example-bot.spec.ts` | 32 |
| `market-closes.spec.ts` | 40 |
| `mcp.spec.ts` | 29 |
| `trading-api.spec.ts` | 196 |
| `perp-api.spec.ts` | 210 |
| `E/done/api-3.5a.spec.ts` | 54, 62, 65, 69 |

## 2. The decision

1. **A quiet request context, `quiet(context)`, not a bigger `call`.** The journeys keep calling Playwright's own methods with Playwright's own arguments, and keep reading the answer through Playwright's own methods. Each change is one receiver (`x.get(` becomes `quiet(x).get(`), and no assertion line changes: `forged.status()`, `await refused.json()` and `answer.headers().location` stay exactly as written.
2. **Its answers are a type of their own** (`QuietResponse`, not `APIResponse`), so the guard can tell a quiet call from a raw one by type alone.
3. **Scope.** In: every request a test sends through Playwright's request client (the `request` fixture, `page.request`, `context.request`, any `newContext()`, and `route.fetch`), in every `.ts` file under `E`, including the hand-run `done/` and `proofs/`. Out, on the evidence above: Node's `fetch` (`support/bypass.ts` included), supabase-js, `aws4fetch`, and the browser's own requests (`page.goto`, `page.evaluate(fetch)`).
4. **The guard is type-based.** It uses TypeScript's checker, not a text scan. A raw send's receiver goes by a dozen names (`request`, `as`, `anyone`, `admin`, `trader`, `owner`…), and text can't tell `request.get(` from `searchParams.get(`.

## 3. Rejected alternatives

- **Extending `call` to every method, headers, `maxRedirects` and raw text:** every `.status()`, `.json()` and `.headers()` read inside an `expect(…)` would become a field (`forged.status`), changing assertion lines. `call` would also need a raw mode for the byte-for-byte comparisons.
- **Patching Playwright's private `_innerFetch` once for the whole worker:** no journey would change, but it rewrites a library's internals out of sight, can break unnoticed on an upgrade, and leaves nothing a guard can check.
- **Wrapping contexts where they're made (a fixture):** misses `browser.newContext().request`, `page.request` and `route.fetch`. A quiet context handed on as an `APIRequestContext` also loses its type, so the guard couldn't tell it apart.
- **A `Proxy` that is itself an `APIRequestContext`:** `toBeOK()` accepts it and prints the log, and the guard can't tell it from a raw context.
- **A text scan in the style of `config.test.ts`:** text can't know a receiver's type, so it would either list every `Map.get` or miss every renamed context.
- **A lint rule:** Biome has no type-aware custom rules, and adding ESLint for one rule is a new tool.

## 4. The rules for the builder

### 4.1 `E/support/quiet-request.ts` (additions only; every current export keeps its behaviour)

1. **Types,** imported as types only from `@playwright/test`, never from `playwright-core` (`config.test.ts` refuses a value from Playwright in an API-only helper):
   - `export type QuietResponse = Pick<APIResponse, 'url' | 'ok' | 'status' | 'statusText' | 'headers' | 'headersArray' | 'body' | 'text' | 'json' | 'dispose'>`. These are Playwright's own signatures, and `json()` keeps its default type, so no `any` is written (Biome's `noExplicitAny`).
   - `type Sends = 'fetch' | 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head'`.
   - `export type QuietRequest = { [M in Sends]: (...args: Parameters<APIRequestContext[M]>) => Promise<QuietResponse> }`.
   - `export type QuietRoute = { fetch: (...args: Parameters<Route['fetch']>) => Promise<QuietResponse> }`.
2. **`export function pathOf(address: string): string`:** what `noAnswer` does today (the path of `new URL(address, 'http://placeholder.invalid')`, else the text before `?`). `noAnswer` then uses it.
3. **`export function quiet(context: APIRequestContext): QuietRequest`:** an object literal with the seven methods written out one by one (no computed keys and no loop, because the guard counts them).
   - Each passes the caller's own arguments to the same method of `context`, unchanged and uncopied: `get: (url, options) => answer('GET', url, () => context.get(url, options))`, and the same for `post`, `put`, `patch`, `delete` and `head`.
   - `fetch: (urlOrRequest, options) => …` takes its method from `(options?.method ?? (typeof urlOrRequest === 'string' ? 'GET' : urlOrRequest.method())).toUpperCase()`, and its address from `typeof urlOrRequest === 'string' ? urlOrRequest : urlOrRequest.url()`.
4. **`export function quietRoute(route: Route): QuietRoute`:** `fetch: (options) => answer((options?.method ?? route.request().method()).toUpperCase(), options?.url ?? route.request().url(), () => route.fetch(options))`.
5. **A private `answer(method, address, send)`:** `const response = await quietly(method, address, send)`, then it returns `quietResponse(method, address, response)`.
6. **The private `quietResponse` holds the raw answer only in its closure,** never as a property, because `util.inspect` of a raw answer prints its headers.
   - `url`, `ok`, `status`, `statusText`, `headers` and `headersArray` call straight through.
   - `body`, `text` and `dispose` run through `quietly(method, address, …)`.
   - `json` reads `text` through `quietly`, then runs `JSON.parse`, as strict as Playwright's own. On a parse failure it throws ``new Error(`${method} ${pathOf(address)} answered ${response.status()} with something that is not JSON`)``, R6's wording, and never quotes the body.
7. **Move `export type Answer` here from `books.ts`,** so `quiet-request.ts` imports nothing from `books.ts`. `quietly`, `noAnswer`'s output, `fetchThrough`, `call`, `callWith` and `send` stay exactly as they are.

### 4.2 `E/support/books.ts`

8. **Delete its `call`.**
   - Add `import { call } from './quiet-request.ts'` for its own `holdings` and `settleAndCheckBooks`.
   - Add `export { call }` and `export type { Answer } from './quiet-request.ts'`, so its other 15 importers change nothing.
   - Each call sends the same options as before (`{ method, data? }`). Only a non-JSON answer's error changes, to R6's message, and no test asserts that error.

### 4.3 The journeys (in each: the import, then the receiver only)

9. **The fixture `request`:** `quiet(request).get(` and `.post(` in `api.spec.ts` (5 sends), `app-sign-in.spec.ts` (3) and `sign-in.spec.ts:275`.
10. **`sign-in.spec.ts`:**
    - `quiet(page.request).get(` at lines 172 and 194;
    - `quietRoute(route).fetch({ maxRedirects: 0 })` at line 154; `route.fulfill` stays on `route`.
11. **The local wrappers keep their own logic:** strict `JSON.parse`, per-request headers, `maxRedirects: 0` and the `PER_ANSWER` filter all stay. Only `request.fetch(` or `as.fetch(` becomes `quiet(request).fetch(` or `quiet(as).fetch(`, in `console-api.spec.ts:59`, `perp-console.spec.ts:89` and `console.spec.ts:100`.
12. **The cross-site writes:** `quiet(trader).fetch(` in `trading-api.spec.ts:196` and `perp-api.spec.ts:210`.
13. **`done/api-3.5a.spec.ts`:** `quiet(anyone).get(` at lines 54, 62, 65 and 69.
14. **Delete the local `fetchThrough` in `market-closes.spec.ts`, `mcp.spec.ts` and `example-bot.spec.ts`,** and import R6's. Drop any import this leaves unused.
    - The first two are R6's word for word.
    - `example-bot.spec.ts`'s copy differs: it passes headers as given, doesn't check for a `null` body, and still gives a 202 its text. None of that matters for anything the bot sends. `examples/bot/bot.ts:80-88` passes a plain object of lower-case names and a string body or none, and no call answers 202 (section 1).
15. **Nothing else in any journey changes.** No `expect(` line is edited.

### 4.4 The guard, `E/quiet-requests.test.ts`

16. **Building the program.**
    - Take every `.ts` file under `E`, found with `files()` as in `config.test.ts`.
    - Read `product/web/tsconfig.json` with `ts.getParsedCommandLineOfConfigFile`, throwing on a config error.
    - Then `ts.createProgram({ rootNames: those files, options: { ...parsed.options, noEmit: true } })`, built once, in a `beforeAll` with a 60-second limit.
    - Import it as `import ts from 'typescript'`: a default import, since TypeScript ships CommonJS. M6's `product/web/lib/client-boundary.test.ts`, on M6's branch while this is written, does the same.
    - Never give Turbo's `test` task an `inputs` list that leaves out `e2e/`; the guard covers new journeys only because their files are in its hash.
17. **What counts as a send.** A send is any of these, where `m` is one of the seven names:
    - a property access `x.m`, whether called or not, so `.bind`, `.call` and `const f = x.get` count;
    - an element access `x['m']` with a literal;
    - a binding `{ m } = x`.

    And the type of `x` must be the interface `APIRequestContext`, or `Route` with `m` being `fetch`, declared in a file whose name ends `/playwright-core/types/types.d.ts`. The type is first made non-nullable, and each member of a union or intersection is checked.
18. **Where a send is allowed:**
    - (a) in `E/support/quiet-request.ts` or `E/support/quiet-request.proof.test.ts`: the allow-list, a constant that holds exactly these two;
    - (b) when the nearest function around it is passed directly as an argument to `quietly` (declared in `E/support/quiet-request.ts`) or `answerOf` (declared in `E/support/social-calls.ts`), with the callee's symbol followed through imports.

    Rule (b) leaves R5's and R6's six such sends as they are.
19. **The failure** lists `file:line method` for every other send, with "send it through quiet(), quietRoute(), call() or callWith() from e2e/support/quiet-request.ts".
20. **It can't pass by finding nothing:** it must scan more than 50 files, and must find in `quiet-request.ts` all seven names on `APIRequestContext` and `fetch` on `Route`. If Playwright renames a type, this fails.
21. **Two text rules,** in every `.ts` file under `E` except the guard itself: no `toBeOK(` and no `_fetchLog`.

### 4.5 The proof, `E/support/quiet-request.proof.test.ts`

22. **Made-up values,** obviously fake and low in entropy (`made-up-key-for-the-proof`, `made-up-cookie-for-the-proof`; the secret check scans every branch).
    - A `tells(error)` helper answers booleans only, so a failure prints neither value.
    - It looks at the message, the stack, `String(error)`, `String(error.cause)`, `util.inspect(error, { showHidden: true, depth: null })` and `JSON.stringify(error.log ?? null)`.
23. **No browser.** Use `vi.spyOn` on `spawn`, `fork` and `execFile` of the CommonJS `child_process`, through `createRequire(import.meta.url)('node:child_process')`, before any context is made. Playwright's bundle reads `spawn` from that object when it starts a browser. `execSync` is left out (the Mac's `sw_vers`).
24. **The contexts** come from `request.newContext()` (`@playwright/test`), with:
    - `baseURL` a local port that was just opened and closed;
    - `extraHTTPHeaders: { authorization: 'Bearer made-up-key-for-the-proof' }`;
    - the cookie in `storageState` for `127.0.0.1`.

    Every context is disposed and every local server closed in `afterAll`.

## 5. Edge cases

| What happens | What must happen |
|---|---|
| A request fails (refused, reset, timed out, its context disposed, `failOnStatusCode`) | `TypeError("METHOD /path got no answer")`: no cause, no host, no query |
| A test times out mid-request | The extra error Playwright reports is the quiet one |
| An absolute address (Supabase's `…/auth/v1/verify?token=…`) | The path only: `GET /auth/v1/verify got no answer` |
| An empty address (`toSupabase?.href ?? ''`) | `GET / got no answer` |
| `quietRoute(route).fetch` fails inside a route handler | The quiet error leaves the handler; the test fails on it as today, without the log |
| `json()` on a body that isn't JSON | `METHOD /path answered STATUS with something that is not JSON`. `text()` answers the text, as today |
| A raw `'{'` body with a JSON content type | Handed to Playwright as given. Playwright sends it as `"{"`, quiet or not (checked) |
| `maxRedirects: 0` | The 303 and its `location` come back as now (checked) |
| A path that carries a secret | It would be printed. No journey puts a key or token in a request's path: keys go in headers, claim tokens in bodies, and a query is dropped anyway |
| A raw answer escaping a `quietly` callback | Its reads can't carry the log (checked); the guard's text rule refuses `toBeOK` |
| A `QuietResponse` passed where an `APIResponse` is wanted (`route.fulfill({ response })`, `toBeOK()`) | A type error. Fulfil with its `status()`, `headers()` and `body()` instead |
| A Playwright upgrade stops writing headers into the log | The proof's raw half fails. Whoever upgrades turns that half around, never the quiet half |
| A Playwright upgrade renames `APIRequestContext` or `Route`, or moves `types.d.ts` | Rule 20 fails, rather than passing on nothing |
| A future helper catches errors itself (`try { await x.get() } catch {}`) | The guard names it; it uses `quiet()` |
| R5's last pull requests, once merged | After the rebase, run the guard; any raw send it names is wrapped the same way (one receiver). That is the only reason M5 would touch a social file |
| `DEBUG=pw:api` | It would print every header of every request. Nothing sets it (no workflow, no script); out of scope |

## 6. The tests that must exist

**The proof** (`quiet-request.proof.test.ts`), each case proving one thing:

1. **Raw:** a closed port's error tells the key and the cookie. The threat is real in this Playwright.
2. **Quiet:** each of `quiet(context)`'s seven methods, plus `call`, `callWith` (with the made-up key as its Bearer) and `fetchThrough`, gives a `TypeError` whose message is exactly `${METHOD} /api/v1/x got no answer` (the address's `?made=up` dropped). Its `cause` is undefined, it has no `log`, and it tells nothing.
3. **Timeout:** a server that accepts the connection and never answers, with `timeout: 300`. The raw error tells both values; the quiet one tells neither.
4. **Reading after the context is gone:** a quiet answer from a local JSON server; after its context is disposed, `text()` rejects with `GET /json got no answer` and tells nothing.
5. **Pass-through,** against one local echo server:
   - `maxRedirects: 0` gives the 303 and its `location`;
   - a `'{'` body with `content-type: application/json` reaches the server byte for byte as the raw call's does;
   - `origin` and `sec-fetch-site` reach it;
   - `text()` equals the raw `text()` byte for byte, `json()` deep-equals the raw one, and `headers()` equal the raw ones (`date` aside).
6. **A 502 HTML body holding the made-up key:** `json()` rejects with `GET /html answered 502 with something that is not JSON`, telling nothing.
7. **Inspecting:** `util.inspect` of `quiet(context)` and of a quiet answer tells nothing.
8. **`quietRoute`, with a stand-in route.** A real `Route` needs a browser, so it isn't practical here. The stand-in's `fetch` throws a Playwright-shaped call log, and the error is `GET /auth/google got no answer` (its address is `https://x.test/auth/google?next=made-up`). `options.method` names a POST. The options object reaches the stand-in unchanged (`toBe` the same object). The code path in section 1 shows the real one sends the same request as `context.request`.
9. **No `spawn`, `fork` or `execFile`** was called.

**The guard** (`quiet-requests.test.ts`):

10. **No send outside the allow-list and the two callbacks.** Run it before the migration and watch it fail, naming exactly the 25 sends in section 1.
11. **The scanner's own forms,** proved with one in-memory file added to the program through the compiler host:
    - it names `ctx.get(…)`, `ctx['post'](…)`, `const { put } = ctx`, `ctx?.fetch(…)`, `ctx.get.bind(ctx)` and `route.fetch()`;
    - it allows `quietly('GET', '/x', () => ctx.get('/x'))`;
    - it names a send in a function nested inside that callback.
12. **The checks of rule 20,** and an allow-list of exactly two files.
13. **The text rules of rule 21.**

**Unchanged:** `quiet-request.test.ts`, `social-calls.test.ts`, `books.test.ts`, `config.test.ts`, and every journey's assertions. The Screen check on the pull request's preview runs every touched journey, which proves the answers read the same.

## 7. Size, files and the order of work

**`[normal]`:** test code only. No product code, database, sign-in or money logic changes.

**The files:**
- `E/support/quiet-request.ts` and `E/support/books.ts`;
- the journeys: `api`, `app-sign-in`, `sign-in`, `console-api`, `perp-console`, `console`, `market-closes`, `mcp`, `example-bot`, `trading-api` and `perp-api` (`.spec.ts`), and `E/done/api-3.5a.spec.ts`;
- new: `E/quiet-requests.test.ts` and `E/support/quiet-request.proof.test.ts`;
- the records.

**Social files:** none of R5's or R6's journeys, fixtures or pages changes, and neither does `support/social-calls.ts`; their sends sit inside `quietly` or `answerOf`. `quiet-request.ts` (R6's; R6 has finished) only gains exports. No file on `docs/social/build.md` section 8.3's shared list is touched (`global-setup.ts` and `pages.ts` stay as they are).

**The order:**
1. Start from a `main` where R5's last pull requests have merged.
2. Write rules 1 to 7 and the proof, and run the proof on its own through the slot.
3. Write the guard and watch it fail with the 25 sends (and any R5 added).
4. Change `books.ts`, then the journeys; the guard passes.
5. Run `pnpm check` through the slot.
6. Open the pull request; the Screen check runs the journeys on the preview.
7. In the same pull request, the records: the status file's open question "A thrown request in a journey can print its headers" moves to Done; R16's rows in `TRACKER.md`; R16's line in the Product brief.

## 8. For the founder, and the open questions

- **The founder:** nothing to do, buy or decide.
- **Left out, as outside the done-test.** A recommendation for each, if the coordinator records them:
  - An assertion that fails prints the values it compared. For example, `console-api.spec.ts` compares whole answer headers, which would include a `set-cookie` if one ever differed. Recommendation: nothing now. No assertion changes in this milestone, and it would print only on a failure that doesn't happen today.
  - A browser navigation's failure names the address it was loading (`page.goto`'s log). A claim link carries its token in its path. Recommendation: nothing now. A journey's claim link belongs to a test agent whose keys are revoked at its end.
