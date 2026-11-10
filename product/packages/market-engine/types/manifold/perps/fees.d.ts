// Written by scripts/types.ts from src/ (pnpm --filter @hrizzup/market-engine types). Do not edit.
import { type PerpState } from './amm.ts';
import type { PerpDirection, PerpPosition } from './position.ts';
/** Default open-side fee, in basis points of notional. Since closing is
 * free, this IS the round-trip cost. Applies to contracts created before the
 * field existed; new contracts stamp it at create time. */
export declare const PERP_TAKER_FEE_BPS_DEFAULT = 10;
/** Upper bound for admin configuration: 100 bps = 1% per open. This caps the
 * BASE rate only — the size-dependent total (see calcPerpSizeFee) is
 * intentionally uncapped, so pool-sized entries pay more than 100 bps. */
export declare const PERP_TAKER_FEE_BPS_MAX = 100;
/** Default size-impact coefficient for the size-dependent fee (deliberately
 * NOT named `k` — the ManiPerp paper already uses k for fundingSensitivity).
 * Shipped at 0 so a deploy changes nothing (the fee stays exactly the flat
 * base); enabled per-contract via update-perp-config once a market is
 * watched live. Launch operating value: 10 (chosen 2026-08-20 so a
 * 4×-pool-size entry pays ~0.6% effective; deterrence of pool-scale
 * informed flow leans on the fee<margin reject, the OI cap, and leverage
 * caps rather than this dial alone). */
export declare const PERP_TAKER_FEE_IMPACT_DEFAULT = 0;
/** Sanity bound for admin configuration of the impact coefficient — 10× the
 * launch operating value of 10, so a fat-fingered config stays survivable
 * (at 100, even a 4×-pool entry pays ~5.4% effective, and the engine's
 * fee<margin reject bounds the per-trade damage regardless). A bound on the
 * CONFIG knob, not on the resulting fee. */
export declare const PERP_TAKER_FEE_IMPACT_MAX = 100;
/** Upper bound for the API-channel base rate: 300 bps = 3% per open. Wider
 * than the web cap on purpose — it exists to price hostile flow: the
 * 2026-08-19/20 BTC drain (M$254k/24h, 100% API-key trades) measured bot
 * captures of 22–30 bps of notional per round trip on average and ~140 bps
 * on the largest momentum entries, so the ceiling must clear the worst
 * observed capture with room to spare. */
export declare const PERP_TAKER_FEE_API_BPS_MAX = 300;
/**
 * Fail-closed guard for the engine, mirroring assertPerpFundingConfig: new
 * contracts are schema-validated, but old rows bypass that schema, and a
 * corrupt fee must block trading rather than silently repricing it.
 * `undefined` is the valid pre-fee-contract case (reads as the default).
 *
 * `isApi` scopes the API-rate check to the channel that rate governs. A
 * corrupt `takerFeeApiBps` must fail closed for API flow — falling back to
 * the base would silently UNDER-charge exactly the flow the rate exists to
 * price — but it must not halt web opens, which that field never touches.
 * Without the scope, one bad JSON value in an API-only field takes the whole
 * market dark for everyone.
 */
export declare const assertPerpTakerFeeConfig: (config: {
    takerFeeBps?: number;
    takerFeeImpact?: number;
    takerFeeApiBps?: number;
}, isApi?: boolean) => void;
/**
 * Effective fee in bps for a contract. Total (never throws) so corrupt legacy
 * data cannot turn a React render into NaN — the engine separately rejects
 * invalid config via assertPerpTakerFeeConfig before any mana moves.
 */
export declare const getPerpTakerFeeBps: (contract: {
    takerFeeBps?: number;
}) => number;
/**
 * The base rate a specific trade pays, selected by auth channel. API-key
 * trades pay `takerFeeApiBps` when it is set — as `max(base, api)`, so a
 * misconfigured API rate below the base can never DISCOUNT bot flow — and
 * the web base otherwise. Missing or invalid `takerFeeApiBps` reads as "no
 * separate API rate" (total, like getPerpTakerFeeBps: render paths must not
 * throw; the engine separately fail-closes via assertPerpTakerFeeConfig).
 *
 * Why per-channel: the 2026-08-19/20 BTC drain was 100% API-key flow, and a
 * flat raise taxes the honest web majority for the bots' edge. The channel
 * check is auth-derived server-side (`auth.creds.kind === 'key'`), never
 * client-supplied — a bot CAN dodge it by scripting a session token, so this
 * is a raised bar and a clean ToS line, not a wall; the structural fix is
 * next-tick execution.
 */
export declare const getPerpEffectiveTakerFeeBps: (contract: {
    takerFeeBps?: number;
    takerFeeApiBps?: number;
}, isApi: boolean) => number;
/** Fee in mana on a notional amount. Returns 0 for any degenerate input. */
export declare const calcPerpTakerFee: (notional: number, feeBps: number) => number;
/**
 * Size-impact coefficient for a contract. Total (never throws), like
 * getPerpTakerFeeBps: corrupt legacy data reads as the default; the engine
 * separately rejects invalid config via assertPerpTakerFeeConfig.
 */
export declare const getPerpTakerFeeImpact: (contract: {
    takerFeeImpact?: number;
}) => number;
/**
 * Size-dependent taker fee in mana on an exposure INCREASE (open, add, or the
 * newly-opened leg of a flip): the marginal rate at pool-share s = N/P is
 * `base + impact·s²` bps, charged as its integral over the added notional
 * [N0, N1]:
 *
 *   fee = (1/10_000) · [ base·(N1−N0) + (impact/(3·P²))·(N1³ − N0³) ]
 *
 * The integral form makes the fee splitting-proof per account: chopping one
 * big add into many small sequential adds costs exactly the same, because the
 * integral is path-independent in notional. ⚠️ That holds only if P itself
 * cannot be moved by the trader's own chunks — the pool banks each add's
 * margin and fee, so P must EXCLUDE the trader's own standing contribution
 * (see perpOpenFeeQuote, which every fee-charging and fee-previewing caller
 * goes through). A fresh position of pool-share S = N1/P pays the effective
 * (average) rate `base + (impact/3)·S²` bps — honest sub-10%-of-pool flow
 * pays ~base, pool-sized entries pay multiples of it. The total is
 * intentionally NOT capped at PERP_TAKER_FEE_BPS_MAX; only the base config
 * is.
 *
 * Computed in share space, (impact/3)·P·(s1³ − s0³), which is algebraically
 * identical but keeps intermediates O(pool) instead of O(notional³).
 *
 * Guards (display path is total, mirroring calcPerpTakerFee): returns 0 when
 * nothing is added or any notional is degenerate; a degenerate pool depth
 * charges the base only (no share to measure against); the result is clamped
 * finite ≥ 0.
 */
export declare const calcPerpSizeFee: (args: {
    notionalBefore: number;
    notionalAfter: number;
    poolDepth: number;
    baseBps: number;
    impact: number;
}) => number;
export type PerpSizeFeeDetails = {
    fee: number;
    effectiveBps: number;
    sizeBps: number;
    poolShareAfter: number;
    depthExhausted: boolean;
};
/**
 * calcPerpSizeFee plus the derived numbers every consumer of the fee needs to
 * explain it — the engine's event stamp, the bet panel's breakdown, and
 * analytics all read THIS so the arithmetic cannot drift between them.
 */
export declare const perpSizeFeeDetails: (args: {
    notionalBefore: number;
    notionalAfter: number;
    poolDepth: number;
    baseBps: number;
    impact: number;
}) => PerpSizeFeeDetails;
/**
 * Effective open-side rate, in bps of notional, for a FRESH position whose
 * notional is `poolShare` × the external pool depth: base + (impact/3)·S².
 * Display helper for turning the bare `takerFeeImpact` coefficient into a
 * number a trader can read ("a pool-sized entry pays ~0.13%"). Delegates to
 * perpSizeFeeDetails (share space is depth-invariant, so P = 1) rather than
 * restating the formula, so the explanation can never drift from the fee
 * actually charged. Total: degenerate inputs read as the base.
 */
export declare const perpFreshPositionFeeBps: (args: {
    baseBps: number;
    impact: number;
    poolShare: number;
}) => number;
/**
 * The one fee-input assembly for an exposure increase — the engine charges
 * from it and the bet panel previews from it, so the state selection can
 * never drift between them.
 *
 * The depth the size term prices against is the pool NET OF the trader's own
 * standing contribution: the mana of theirs that is still IN the pool, which
 * is `min(costBasis, positionValue)` plus the fees they have already paid.
 * Two reasons:
 *
 *  1. Splitting-proofness for real: the pool banks each add's margin and fee,
 *     so pricing against the gross pool let sequential adds ride a depth the
 *     trader deepened themselves — chopping one pool-sized 1× entry into
 *     chunks cut its size fee ~75%. Netting out the trader's own contribution
 *     makes the depth invariant across their own adds, so the integral
 *     telescopes exactly and one open costs the same as any partition of it.
 *
 *  2. It prices the right risk: the trader's own money is not liquidity
 *     available to back the position being priced. It leaves with them at
 *     close (closing is free), so counting it as depth would let a trader
 *     buy a cheaper fee simply by already being large.
 *     (Careful with the mechanics here — `closePosition` pays a LOSING
 *     position's whole payout, and a winning one's principal, out of its
 *     OWN side's pool; only the profit leg is drawn from the opposing pool.
 *     So the gross `L + S` really is the escrow this claim sits against,
 *     which is why the denominator is gross-minus-own rather than the
 *     opposing pool alone.)
 *
 * ⚠️ The netted amount is `min(existingCostBasis, existingPositionValue)`,
 * NOT the raw cost basis, because what belongs in the deduction is the
 * trader's CLAIM on the pool, not the history of what they posted.
 * `costBasis` is the margin they put in and is never marked to market;
 * `min(costBasis, positionValue)` is what a close would actually hand back
 * right now, and is the same expression `calculateAvailableCover` and
 * `applyADL` already use for a holder's claim — so the fee now agrees with
 * the solvency math instead of contradicting it.
 *
 * The motivating failure: once a counterparty CLOSES at a profit,
 * `closePosition` debits the loser's pool by that profit, so `grossPoolDepth`
 * falls while `costBasis` does not. Netting the raw basis then deducts mana
 * that really has left the pool, and the fee is quadratic in 1/depth, so the
 * error squares. Measured before this change: a 1× long 40% underwater on a
 * market whose counterparty had realized paid 951× what a fresh account paid
 * for the identical added notional (M$19,488.68 vs M$20.49 at impact 90;
 * 109× at impact 10) — 97.4% of its own margin, charged rather than
 * rejected. A ~30% larger add crossed the fee<margin reject outright.
 *
 * ⚠️ CALIBRATION CONSEQUENCE, deliberate but worth knowing. A MARK MOVE
 * moves no mana — only closes, factor-0 ADL and resolution do — so
 * `min(costBasis, positionValue)` is an upper bound on what has left the
 * pool, tight only after a counterparty has actually realized. An UNREALIZED
 * drawdown therefore releases part of the deduction while every mana is
 * still sitting in the pool: two holders identical in pools, posted margin,
 * notional and mark, differing only in entry price, pay different fees — at
 * base 10 / impact 90, gross 500,400, a 200,000 position adding 20,000 pays
 * M$74.96 when 40% underwater vs M$108.15 when flat (−30.7%; −35.6% on a
 * 400,000 add). That is the price of pricing the claim rather than the
 * history, and it is bounded by the trader's own posted margin. It cuts fee
 * revenue and size deterrence for low-leverage holders adding into a
 * drawdown; it does not affect solvency, and the levered tick-snipers the
 * fee targets liquidate long before it matters. Revisit at the pre-enable
 * calibration step if that trade-off is not wanted.
 *
 * Two halves of that expression, both load-bearing:
 *
 *  - The FLOOR at position value releases margin that has already been paid
 *    out to winners, so a losing holder is not charged for mana that is gone.
 *  - The CAP at cost basis keeps the deduction to what the trader actually
 *    put in. Unrealized profit is not a contribution — it is a claim payable
 *    from the OPPOSING pool — so letting `value > costBasis` enlarge the
 *    deduction would shrink the depth and overcharge a winning holder for
 *    money they never posted.
 *
 * The taker-fee basis stays OUTSIDE the min, uncapped: those fees were paid
 * in cash and are not part of the position's mark. Folding them inside would
 * let a sequence of adds shrink its own deduction as the position drifts,
 * breaking the splitting-proofness the netting exists to guarantee.
 *
 * The cap does not disturb the splitting-proof telescoping. At a fixed mark
 * an add of margin `m` raises costBasis by `m` and positionValue by `m` too
 * (the new tranche opens at the mark, so it carries π = 0 and the merged
 * entry price conserves the old π), which means `costBasis − positionValue`
 * is CONSTANT across the trader's own adds. `min(costBasis, positionValue)`
 * therefore grows by exactly `m` whichever side of the min is active, the
 * pool grows by `m` + fee, and the depth is invariant — the same reason the
 * raw basis telescoped. Only when the mark MOVES do the two diverge, and
 * that is a genuine change in how much of the trader's money is still in the
 * pool. (`positionValue === costBasis` is the special case π = 0, not the
 * general rule: an underwater holder telescopes just as exactly, with the
 * difference pinned at its drawdown.)
 *
 * When the trader's contribution meets or exceeds a VALID gross pool, the
 * size fee has no denominator and cannot be priced — the returned fee is
 * base-only and `depthExhausted` is set. That state is reachable (a side
 * pool drained below its holders' aggregate STANDING claim while the
 * opposing pool still gives the OI cap headroom), so it must NOT trade at
 * base: the engine fails closed on the flag and the panel blocks submit.
 * With the mark-to-market cap it now fires only when the pool genuinely
 * cannot cover the holder, rather than whenever the holder's historical
 * margin happened to exceed a drawn-down pool.
 */
export declare const perpOpenFeeQuote: (args: {
    grossPoolDepth: number;
    existingSize: number;
    existingCostBasis: number;
    existingPositionValue: number;
    existingTakerFeeCostBasis: number;
    addedNotional: number;
    baseBps: number;
    impact: number;
}) => PerpSizeFeeDetails;
/** The most of a trade's own margin the opening fee may consume before the
 * engine refuses to open at all.
 *
 * The fee is charged on NOTIONAL but a trader feels it against MARGIN, and
 * leverage is the multiplier between the two:
 *
 *   fee / margin = effectiveBps × leverage / 10_000
 *
 * so a rate that is trivial at low leverage is not at high leverage. At the
 * launch impact of 10, a pool-sized entry is 13.3 bps — 0.4% of margin at 3×,
 * but 13.3% at 100×, and a position 3.5× the backing pool costs 51% of margin
 * at 100×. That last one is reachable today: it is roughly the largest short
 * BTC's open-interest cap permits.
 *
 * Why 0.5 rather than the 1.0 this replaces: at 1.0 the only thing between an
 * ordinary fee and a catastrophic one was a guaranteed-total-loss check, so a
 * mispriced fee could take 99% of a margin and still execute (it did — see
 * perpOpenFeeQuote's note on the pre-mark-to-market netting, which CHARGED
 * 97.4% of margin rather than rejecting). At 0.5 the bound is unreachable at
 * leverage ≤ 20 for any size the OI cap permits, so it costs nothing in false
 * rejections, and it halves the blast radius of whatever the next pricing
 * surprise turns out to be. It also tightens #4015's fat-fingered-API-rate
 * case, which crossed the old floor only above 33× and now crosses above 17×.
 */
export declare const PERP_MAX_FEE_SHARE_OF_MARGIN = 0.5;
/** Fee slippage a caller accepts between previewing a trade and it executing,
 * in BPS OF THE TRADE'S NOTIONAL — the unit a trader already thinks in for
 * slippage, and the unit the rejection message speaks.
 *
 * Sized as a fraction of NOTIONAL rather than as a percentage of the fee on
 * purpose. The impact term goes as 1/depth², so a percentage-of-fee band
 * tightens exactly as the fee grows: the previous "fee × 1.01" bound rejected
 * a M$1M BTC entry once only M$1,974 (0.52% of the pool) had left, and got
 * stricter the larger the trade. A bps-of-size band is scale-invariant — the
 * same M$1M entry now tolerates M$62k of outflow at impact 10 — and it is a
 * number a trader can reason about, because it is directly comparable to the
 * fee itself. */
export declare const PERP_FEE_SLIPPAGE_BPS = 10;
/**
 * The `maxFee` a client should send alongside a previewed fee.
 *
 * A ZERO preview still authorises exactly zero: "free" has to mean free, so a
 * client whose config is stale (impact was just enabled) cannot silently
 * consent to a fee it never showed. Slippage room is only granted once the
 * trader has accepted a nonzero number.
 */
export declare const perpMaxFeeFor: (previewedFee: number, notional: number) => number;
/**
 * A fee or allowance in whole cents, for messages. Fees round up and
 * allowances down, so a fee above its allowance never prints as the same
 * amount (a 0.04-cent shortfall used to read "M$0.60 … more than M$0.60").
 * The epsilon keeps float noise (0.6 × 100 = 60.000000000000007) on its cent.
 */
export declare const formatPerpFeeCents: (amount: number, round: "up" | "down") => string;
/**
 * The own-contribution half of `perpOpenFeeQuote`'s inputs, derived from the
 * trader's standing SAME-direction position at the trade's mark.
 *
 * Extracted because both fee-charging callers — the engine inside its locked
 * transaction and the bet panel's preview — have to derive these four fields
 * identically, and deriving them twice is how the two drift. In particular
 * `existingPositionValue` must be `getPositionValue(position, price)` and not
 * `position.costBasis`: the whole point of the netting is that the deduction
 * tracks the trader's current claim on the pool rather than the margin they
 * once posted. That single substitution is a ~24x mispricing on a drawn-down
 * book and it type-checks, so it lives here where a test can pin it.
 *
 * `undefined` (a fresh open, or a flip's newly opened leg) yields all zeros:
 * a flip's closed leg has already left `grossPoolDepth` via its payout, so it
 * must not also be subtracted here.
 */
export declare const perpOwnContributionInputs: (standingSame: PerpPosition | undefined, price: number) => {
    existingSize: number;
    existingCostBasis: number;
    existingPositionValue: number;
    existingTakerFeeCostBasis: number;
};
export type PerpOpenCashFlow = {
    /** Margin plus opening fee: the mana that leaves the trader's balance. */
    totalDebit: number;
    /** Balance plus a flip's free close payout — what can fund the debit. */
    spendableBalance: number;
    isAffordable: boolean;
};
/**
 * Cash required to open/add a position and whether the trader can fund it.
 * Shared by the engine's authoritative check and the bet panel's preview so
 * the two cannot disagree — the panel used to validate margin against raw
 * balance alone, which let a max-balance open through to a server 403 once
 * the fee was added, and blocked a payout-funded flip the engine accepts.
 *
 * The fee is an INPUT, not recomputed here: it is whatever perpOpenFeeQuote
 * priced for this trade (size-dependent, channel-dependent), so this helper
 * stays correct however the fee schedule evolves. `closePayout` is the free
 * close of an opposite-side position on a flip — the engine credits it
 * before debiting the new leg, so it may fund the new margin and fee (a
 * trader whose mana is all in the position they are flipping out of).
 *
 * Fails closed (undefined) on any non-finite or negative input so a corrupt
 * balance or fee can never read as affordable.
 */
export declare const calculatePerpOpenCashFlow: (params: {
    balance: number;
    margin: number;
    openFee: number;
    closePayout?: number;
}) => PerpOpenCashFlow | undefined;
/**
 * Credit a collected fee to one side's backing pool. Pure, like the amm.ts
 * transitions: the caller persists the new pool. The fee mana enters
 * contract escrow with the open-margin debit, so ledger = poolLong +
 * poolShort remains a checkable invariant.
 */
export declare const creditPerpPoolFee: (state: PerpState, side: PerpDirection, fee: number) => PerpState;
/**
 * Add an opening/add fee to the live position's user-facing cost basis without
 * changing AMM margin, leverage, or liquidation math. Returns a new state and
 * position; the input objects are never mutated.
 */
export declare const accruePerpPositionTakerFee: (state: PerpState, position: PerpPosition, fee: number) => {
    state: PerpState;
    position: PerpPosition;
};
