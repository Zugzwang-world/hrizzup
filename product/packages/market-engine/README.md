# @hrizzup/market-engine

The maths behind Hrizzup's play-money yes/no markets (PLAN.md step 1.7a): a market's price, buying, limit orders, selling, Yes and No cancelling out, fees, and settlement. It is plain calculation, with no database, network or screens. The rest of step 1.7 (our tables, trades inside database transactions, the ledger) builds on it.

The maths is [Manifold's](https://github.com/manifoldmarkets/manifold), copied with its tests and kept close to Manifold's own code, so the two stay easy to compare. Which files to take was settled in [docs/research/round-2-readiness.md](../../../docs/research/round-2-readiness.md) (section C9) and [docs/research/manifold.md](../../../docs/research/manifold.md).

## Where it comes from

- **Source:** `common/src/` in github.com/manifoldmarkets/manifold, commit `79997aafcf0d8d826eb51dad5c7712e63d35de65` (5 November 2026).
- **Licence:** MIT, "Copyright (c) 2022 Manifold Markets, Inc." The full licence is beside the code in [src/manifold/LICENSE.md](src/manifold/LICENSE.md), and the copy is listed in [THIRD_PARTY_NOTICES.md](../../../THIRD_PARTY_NOTICES.md).

## Layout

- **[src/index.ts](src/index.ts):** the package's front door, naming the parts a yes/no market uses.
- **[src/manifold/](src/manifold/):** Manifold's files, at the same paths they have under Manifold's `common/src/`, with Manifold's tests beside the files they test.

| Kind                                         | Files                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Manifold's yes/no maths                      | `calculate-cpmm.ts` (the pool: prices, shares, fees, limit-order matching, selling, liquidity), `new-bet.ts` (buying, with or without a limit price), `sell-bet.ts` and `sell-preview.ts` (selling), `redeem.ts` (Yes and No cancelling out), `payouts.ts`, `payouts-fixed.ts` and `calculate-fixed-payouts.ts` (settlement), `fees.ts`, `calculate.ts`, `calculate-metrics.ts` and `contract-metric.ts` (positions and profit), `bet.ts` and `liquidity-provision.ts` (types) |
| Brought because the maths imports them       | `calculate-cpmm-arbitrage.ts` (markets with several answers; kept as Manifold wrote it and unused), `answer.ts`, `util/math.ts`, `util/algos.ts`, `util/object.ts`, `util/time.ts`                                                                                                                                                                                                                                                                                             |
| Brought because Manifold's tests import them | `number.ts` and `util/array.ts` (for `calculate-cpmm-arbitrage.test.ts`), `answer-probs.ts` (for `conservation-grid.test.ts`)                                                                                                                                                                                                                                                                                                                                                  |
| Manifold's, trimmed                          | `new-contract.ts`: opening a market, cut down to the two kinds Manifold's tests here open (yes/no and multiple choice)                                                                                                                                                                                                                                                                                                                                                         |
| Ours, in place of Manifold's                 | `contract.ts`: a slim market type keeping Manifold's type names but only the fields the maths reads. `api/utils.ts`: only the error class the maths raises                                                                                                                                                                                                                                                                                                                     |
| Manifold's tests (11 files, 158 tests)       | `calculate-cpmm`, `calculate-cpmm-arbitrage`, `sell-preview`, `sell-bet`, `liquidity-withdrawal`, `util/algos`, `answer`, `answer-p-default`, `cpmm-multi-2-sanity-guards`, `versus-arbitrage` and `conservation-grid` (`.test.ts`)                                                                                                                                                                                                                                            |

**Hrizzup opens only yes/no markets** (`BinaryContract`: mechanism `cpmm-1`, outcome `BINARY`). Manifold's code for its other kinds of market (several answers, numbers, dates, "stonks") stays in the files because the maths branches on them, but Hrizzup never opens them.

**Not taken:** Manifold's `contract.ts` (802 lines, about 100 files through its imports, a rich-text editor among them), its `api/utils.ts` (it chains into a 5,436-line schema), `util/random.ts` (part of it is under a Stack Overflow licence; bet and answer ids come from `crypto.randomUUID()` instead), `chart.ts` (only a chart helper in `bet.ts` used it), and Manifold's two optional probes and its speed benchmark (`net-g-monotonicity-probe`, `sell-domain-probe`, `cpmm-perf-bench`), which skip themselves unless switched on.

## What changed from Manifold's code

**In every file, only what our coding rules need:**

- **Imports:** `lodash` becomes `lodash-es` (the same library as ES modules); `common/x` imports become relative paths; every relative import names its `.ts` file; type-only imports are marked `type`. lodash's `Dictionary` type comes from lodash's own types (`@types/lodash`), which `lodash-es`'s types don't carry.
- **Formatting:** Biome's (semicolons, lines up to 100 characters, imports in order).
- **Tests:** each imports `describe`, `expect` and `it` from Vitest, instead of using Jest's globals.

**Beyond that, in Manifold's files:**

- `bet.ts`: the chart helper `calculateMultiBets` is left out (it needs `chart.ts`), and `getNewBetId` returns `crypto.randomUUID()` instead of Manifold's 12-character random id.
- Biome's errors, each fixed without changing what the code does: a few `forEach` callbacks that returned a value now have a block body (`answer-probs.ts`, `calculate-metrics.ts`, `fees.ts`, and four tests); `calculate-metrics.ts` compares answer ids with `(a ?? null) === (b ?? null)`, which is what its `==` did; `number.ts` uses `===` on a length; `calculate.ts` gives one variable its type.
- `calculate-cpmm-arbitrage.ts` keeps Manifold's text exactly, apart from its import lines and one redaction, and Biome skips it (`biome.json`), so it stays easy to compare. The redaction: a commented-out example of a Manifold market carries a Firebase Storage access token (in an image address from Manifold's development site), which our secret check rightly refuses, so the token reads `REDACTED`.

## Hrizzup's changes

Our changes to what the maths does (milestone 2), each pinned by a test in [src/changes.test.ts](src/changes.test.ts):

- **The time is passed in.** Buying (`getBinaryCpmmBetInfo`), selling (`getCpmmSellBetInfo`), redeeming (`getRedemptionBets`), the profit figures (`calculateUserMetricsWithoutLoans` and the functions under it) and `tradingAllowed` take the time as their last argument, `now`, in milliseconds since 1970, instead of reading the clock: it stamps the bet and its fills and decides which limit orders have expired, so one trade inside one database transaction uses one time, and tests repeat exactly. The functions those share with Manifold's multi-answer code (`computeFills`, `computeCpmmBet`, `calculateCpmmSale`, `calculateAmountToBuyShares`) take `now` as an optional last argument: the yes/no path always passes it; Manifold's multi-answer code, kept switched off, leaves it out and still reads the clock, as Manifold wrote it. A test makes the clock throw while buying, filling a limit order, selling, redeeming and settling.
- **No loans.** A sale and a redemption always carry a loan of 0; their loan inputs are gone (`getCpmmSellBetInfo` no longer takes `loanPaid`, `getRedemptionBets` no longer takes `loanPayment`), and redeeming ignores any loan a position might carry.
- **Manifold's other features stay switched off:** markets with several answers, numbers, dates and "stonks" are never opened; our slim market type has no second currency, leagues, ranking, bonuses or subsidy pools. Manifold's market-ranking measure (elasticity) is left as it was.
- **No logging:** the two `console.log` calls in the yes/no maths are gone (selling, and the profit figures). Manifold's switched-off multi-answer code keeps its own.
- **The two error messages** in `computeFills` show their numbers: they were in single quotes, so they printed `${betAmount}` literally. The second named `limitProb`, which is declared later in the function, so it now shows the limit price passed in (`initialLimitProb`); a plain template literal would itself have crashed.
- **Fees: one setting, at zero.** `TAKER_FEE_RATE` in `fees.ts` (Manifold's unexported `TAKER_FEE_CONSTANT`, renamed and exported) sets every yes/no trade's fee, `rate × p × (1 − p) × shares`. It stays 0 until the Product chat decides the rate.

The front door no longer offers `computeFills` and `computeCpmmBet`, whose time is optional; buying and selling cover them.

## Checks

- **Tests:** `pnpm --filter @hrizzup/market-engine test` (Vitest). Quick checks run them on every pull request, with the type check.
- **TypeScript:** our shared settings, except `noUncheckedIndexedAccess`, which is off in this package only ([tsconfig.json](tsconfig.json) says why): with it on, about 300 lines of proven maths and tests would need rewriting.
- **Biome:** every file is formatted and linted, with one override for `src/manifold/` (in `biome.json`) that switches off style-only rules for Manifold's code (non-null assertions, `any`, string keys, template strings and the like) and Manifold's own `isNaN` and `isFinite` checks, whose `Number.` versions behave differently for values that aren't numbers. React's and Next.js's rules are off for the whole package, which has no screens.

## Comparing with Manifold

To see exactly how one of our files differs from Manifold's: fetch Manifold at the commit above, copy its file into this folder under a new name, apply the import changes listed above, run `pnpm exec biome check --write` on it, and compare the two files. What remains is the list of changes above.
