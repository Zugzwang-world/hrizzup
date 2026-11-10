// Written by scripts/types.ts from src/ (pnpm --filter @hrizzup/market-engine types). Do not edit.
import type { PerpDirection, PerpPosition } from './position.ts';
export type PerpPool = {
    L: number;
    S: number;
};
export type PerpState = {
    pool: PerpPool;
    positions: PerpPosition[];
};
export type AdlSettlement = {
    /** Position immediately before the factor-zero ADL. */
    position: PerpPosition;
    /** Remaining margin returned to the user from the position's own pool, less
     * any float dust that pool was short (see debitPool). */
    payout: number;
};
/** Current mana available across both sides to back position payouts. */
export declare const getPerpBackingPool: (poolLong: number, poolShort: number) => number;
export declare const getLeverage: (size: number, costBasis: number) => number;
/**
 * Floor for the leverage a trade request may ask for. The UI never offers
 * sub-1× leverage, and as ℓ → 0 the 1/ℓ term in the liquidation-price
 * formula overflows float64 to ±Infinity, which the state validators
 * (correctly) refuse. Existing positions can still drift below 1× through
 * ADL haircuts — this floor applies to requested leverage only.
 */
export declare const MIN_PERP_LEVERAGE = 1;
/**
 * Liquidation price (paper eq. 1):
 *   long:  P_liq = (1 - 1/ℓ) · P_e
 *   short: P_liq = (1 + 1/ℓ) · P_e
 */
export declare const liquidationPrice: (direction: PerpDirection, entryPrice: number, leverage: number) => number;
/**
 * Unrealized equity π (paper eq. 13) for any direction.
 *   long:  π = (P - P_e) / P_e · q
 *   short: π = (P_e - P) / P_e · q
 */
export declare const getUnrealizedEquity: (position: PerpPosition, price: number) => number;
/** Current value of an open position (c + π), floored at 0. */
export declare const getPositionValue: (position: PerpPosition, price: number) => number;
/**
 * Entry price of two tranches collapsed into one position, such that the
 * merged position's equity equals the sum of the tranches' equities at every
 * price (see the note on `openPosition`).
 *
 * Because π is linear in the unit count q/Pe, that means adding units:
 *   (q₁ + q₂) / Pe = q₁/Pe₁ + q₂/Pe₂
 * i.e. the units-weighted harmonic mean. Always lies between Pe₁ and Pe₂.
 */
export declare const mergedEntryPrice: (size1: number, entryPrice1: number, size2: number, entryPrice2: number) => number;
/**
 * Inverse of `mergedEntryPrice`: given the merged position and the tranche
 * that was just added, recover the entry price the position had before.
 * Used by period-metric reconstruction to replay `add` events backwards.
 *
 * Returns undefined when the inputs cannot describe a real merge (the unit
 * count of the prior tranche must be strictly positive).
 */
export declare const unmergeEntryPrice: (sizeBefore: number, sizeAfter: number, entryPriceAfter: number, sizeAdded: number, addedPrice: number) => number | undefined;
/**
 * Imbalance function I(r) (paper eq. 4).
 * Defined for r >= 1; caller should swap pools when S > L and negate sign.
 *
 *   I(r) = (r - 1) / (r - 1 + k)
 */
export declare const imbalance: (r: number, k: number) => number;
/**
 * Aggregate open notional per side — the exposure actually at risk.
 *
 * This is NOT interchangeable with the backing pools. A pool holds margin,
 * so pool ratio only tracks exposure ratio when both sides run comparable
 * leverage. Where they don't, the two can disagree in SIGN: on 2026-08-08
 * the BTC market held 454k long vs 348k short of notional (1.30 long-heavy)
 * on pools of 59.6k long vs 83.0k short (0.72 — reading short-heavy), so
 * pool-driven funding paid the crowded side and charged the scarce one.
 */
export declare const getPerpOpenInterest: (positions: PerpPosition[]) => {
    long: number;
    short: number;
};
/**
 * Funding rate for the period, from the two sides' OPEN INTEREST (notional).
 *
 *   +ve means longs pay shorts (longs crowded);
 *   -ve means shorts pay longs (shorts crowded).
 *
 * Pass `getPerpOpenInterest(...)`, never the backing pools — see that
 * function for why the two disagree. The parameters are deliberately named
 * for the quantity rather than L/S: those names are what invited the pools
 * in the first place.
 *
 * A side with zero open interest yields a rate of zero: funding transfers
 * between the two sides' positions, so with nobody on one side there is no
 * counterparty to receive it. Inducing entry onto an empty side needs a
 * mechanism that pays from somewhere other than the absent side, which is
 * out of scope here.
 */
export declare const computeFundingRate: (openInterestLong: number, openInterestShort: number, k: number, fMax: number) => number;
/**
 * Runtime guard for persisted contract economics.
 *
 * New contracts are schema-validated, but old rows bypass that schema. A
 * funding cap of 1 could erase the paying side in one tick, creating
 * zero-margin positions and an unpayable transition. Fail closed instead of
 * silently clamping and changing the contract's stated economics.
 */
export declare const assertPerpFundingConfig: (config: {
    fundingSensitivity: number;
    maxFundingRate: number;
}) => void;
/**
 * Apply a funding event (paper §2.3, eq. 5–9).
 * Pure: returns new pool and updated position list.
 */
export declare const applyFunding: (state: PerpState, fundingRate: number) => PerpState;
export declare const isLiquidated: (position: PerpPosition, price: number) => boolean;
/**
 * Process liquidations at oracle price P (paper §2.4, eq. 10).
 * Liquidated positions have their size and cost basis zeroed; margin stays in
 * the pool (L unchanged). Returns new state + list of liquidated positions.
 */
export declare const processLiquidations: (state: PerpState, price: number) => {
    state: {
        pool: PerpPool;
        positions: PerpPosition[];
    };
    liquidated: PerpPosition[];
};
/**
 * Auto-deleverage (paper §2.4, eq. 11–12).
 * Only profitable positions are scaled down; cost basis unchanged.
 */
export declare const applyADL: (state: PerpState, price: number) => {
    state: {
        pool: {
            L: number;
            S: number;
        };
        positions: PerpPosition[];
    };
    adlFactorLong: number;
    adlFactorShort: number;
    settled: AdlSettlement[];
    crossSideTransfer: number;
};
export type OpenResult = {
    state: PerpState;
    position: PerpPosition;
    deltaSize: number;
    deltaCostBasis: number;
    deltaOriginalCostBasis: number;
};
/**
 * Open or add to a position (paper §2.2, eq. 3).
 *
 * The paper keeps every tranche separate (`P' = P ∪ [(d, m·ℓ, m, P)]`). We
 * collapse them into one row per (user, direction), so the merged entry
 * price has to be chosen such that the collapsed position has exactly the
 * same equity as the two tranches would have had.
 *
 * Equity (eq. 13) is π = ±(P − Pe)/Pe · q, where q is mana-NOTIONAL, so the
 * underlying unit count is q/Pe. Merging conserves value only if the units
 * add up: q/Pe = q₁/Pe₁ + q₂/Pe₂, i.e. the merged entry price is the
 * units-weighted HARMONIC mean, not the arithmetic one.
 *
 * Using the arithmetic mean here silently mints equity for shorts and burns
 * it for longs on every add — by q₁·q₂·(1−r)²/(q₁ + r·q₂) with
 * r = P_add/Pe₁, paid out of the opposing pool. See the value-conservation
 * tests in amm.test.ts.
 *
 * `metric-periods.ts` reverses this exact formula to reconstruct historical
 * positions. The two must change together.
 *
 * Caller must enforce one-way mode before calling this.
 */
export declare const openPosition: (state: PerpState, userId: string, contractId: string, direction: PerpDirection, mana: number, leverage: number, oraclePrice: number, existing: PerpPosition | undefined, now: number) => OpenResult;
export type CloseResult = {
    state: PerpState;
    payout: number;
    pnl: number;
    poolLongDelta: number;
    poolShortDelta: number;
    /** Fraction actually closed — 1 for a full close, including a partial one
     * promoted to a full close because its remainder would have been dust. */
    fraction: number;
    /** The closed leg's share of the row. Equals the row's own values on a
     * full close, so callers can stamp events from these unconditionally. */
    closedSize: number;
    closedCostBasis: number;
    closedOriginalCostBasis: number;
    closedTakerFeeCostBasis: number;
    /** The surviving row, or null when the whole position was closed. */
    remainingPosition: PerpPosition | null;
};
/**
 * Smallest fraction of a position a partial close may take.
 *
 * Below this the close is not worth the row it writes: it mints an event (and
 * its streak credit) for a change the trader cannot see, and on a small
 * position the payout rounds to nothing. A caller wanting less should not
 * close at all.
 */
export declare const PERP_MIN_CLOSE_FRACTION = 0.01;
/**
 * Margin below which a partial close's REMAINDER is not worth keeping open,
 * so the close is promoted to a full one.
 *
 * Without this, `fraction = 0.9999` leaves a row of a few thousandths of a
 * mana that still accrues funding every period, still shows on the market
 * page, and still has to be closed by hand. The bound is on the remaining
 * COST BASIS rather than on `1 - fraction` because that is the quantity that
 * has to stay meaningful: a fractional rule would strand dust on a large
 * position and delete real margin on a small one.
 */
export declare const PERP_MIN_REMAINDER_COST_BASIS = 0.01;
/**
 * Relative slack between the notional a partial close was sized against and
 * the row the transaction actually locked.
 *
 * Representation dust only — NOT semantic drift. `size` round-trips through a
 * postgres `numeric` and back, and that is the only difference this is here to
 * forgive. Anything that genuinely moved the row (funding scaling it, an ADL
 * haircut, another partial close landing first) must fail the check, because
 * in every one of those cases the fraction the caller chose was chosen against
 * a position that no longer exists, and applying it to the survivor silently
 * executes a different trade than the one they consented to.
 */
export declare const PERP_EXPECTED_SIZE_TOLERANCE = 1e-9;
/**
 * Whether a partial close's `expectedSize` still describes the locked row.
 *
 * Relative, so it means the same thing on an M$10 position and an M$10m one.
 */
export declare const perpSizeMatchesExpectation: (actualSize: number, expectedSize: number) => boolean;
/**
 * The fraction a close will ACTUALLY take, given what the caller asked for.
 *
 * Separate from `closePosition` so a caller can price and describe the close
 * ("this closes your whole position") before committing to it, and so the
 * promotion rule has exactly one definition.
 */
export declare const resolvePerpCloseFraction: (position: Pick<PerpPosition, "size" | "costBasis">, requested: number) => number;
/**
 * Close all or part of a long or short position at the oracle price (paper
 * §2.5, eq. 13–15). Solvency invariant guarantees the opposing pool can
 * cover π > 0.
 *
 * A partial close is exactly `fraction` of the full one. π is linear in `q`,
 * and the payout and both pool debits are linear in π and `c`, so closing
 * `z` of a row leaves the book in precisely the state it would have been in
 * had the trader opened `1 - z` of that position and closed a separate `z`
 * one — which is why the survivor keeps its entry price, its leverage
 * (ℓ = q/c is invariant under the split) and therefore its liquidation price.
 * Nothing about the risk of the remaining exposure changes.
 */
export declare const closePosition: (state: PerpState, position: PerpPosition, price: number, 
/** Fraction of the position to close; 1 (the default) closes all of it.
 * A fraction whose remainder would be dust is promoted to a full close, so
 * read `fraction` off the result for what actually happened. */
requestedFraction: number, now: number) => CloseResult;
/**
 * Launch guardrail beyond the ManiPerp paper: aggregate exposure on either
 * side may not exceed this multiple of the backing the opposing side provides.
 *
 * This still permits high leverage for small positions, while preventing a
 * freshly opened position (which has no unrealized profit yet) from creating
 * effectively unlimited future claims against a finite pool.
 *
 * Read it as an adverse move of 1/M where M is this multiple: the cap is sized
 * so this side's profit over a 10% move still fits the backing available for
 * it. See `calculateMatchedCredit` for the derivation.
 */
export declare const PERP_OPEN_INTEREST_COVER_MULTIPLE = 10;
export type PerpOpenInterestCapacity = {
    openInterest: number;
    availableCover: number;
    /** Notional the opposing book funds out of its own losses. */
    matchedCredit: number;
    limit: number;
    headroom: number;
    isWithinLimit: boolean;
};
export declare const isPerpOpenInterestWithinLimit: (openInterest: number, limit: number) => boolean;
/**
 * Aggregate side capacity at the current oracle price.
 *
 * `availableCover` deliberately deducts each opposite-side position's current
 * refundable value, capped at its cost basis. This is the same reserve used by
 * the ADL solvency calculation, so committed trader margin is not counted as
 * free backing for new exposure. `matchedCredit` then adds back the exposure
 * the opposing book funds out of its own losses — see above.
 */
export declare const getPerpOpenInterestCapacity: (side: PerpDirection, state: PerpState, price: number) => PerpOpenInterestCapacity;
/**
 * Capacity seen by the opening leg of a trade.
 *
 * A flip closes the trader's opposite-side position first. That close changes
 * both the opposing pool and the opposing open interest used by the cap, so a
 * client preview against the unmodified book can promise headroom that the
 * atomic engine correctly rejects after performing the close.
 */
export declare const getPerpOpenInterestCapacityForOpen: (side: PerpDirection, state: PerpState, price: number, positionToClose?: PerpPosition) => PerpOpenInterestCapacity;
/**
 * Solvency factor for a side: cover over profit, >= 1 when every winner could
 * close now and be paid in full. This is the raw ratio, the same scale ADL
 * applies, and it words the errors. The pass/fail decision is
 * isPerpSideSolvent, which also forgives float dust that this ratio magnifies
 * without bound as the profit shrinks toward zero.
 */
export declare const solvencyFactor: (side: PerpDirection, state: PerpState, price: number) => number;
/**
 * Relative tolerance for the post-correction solvency ratio. ADL targets
 * exactly 1, so a small allowance is needed for floating-point division.
 */
export declare const PERP_SOLVENCY_FACTOR_TOLERANCE = 1e-12;
/**
 * Mana by which a side's cover may fall short of its profit and still pass:
 * float residue, which the RELATIVE tolerance above stops absorbing once the
 * profit it is measured against is tiny or zero. Cover an ulp below zero with
 * no profit reads as -Infinity; cover an ulp of a 100-mana pool short of a
 * 5e-6 profit reads as 1 - 3e-9.
 *
 * Scaled to the book the way poolAfterDebit scales pool dust, under the same
 * 1e-6 cap: 1e-12 of the largest pool, reserve or profit. That is rounding at
 * the book's OWN scale. Dust from an operand that has already left the book
 * can be far larger (a 50,000 profit paid from a 50,001 pool leaves 7e-12 on
 * a book whose largest number is 1), so debitPool absorbs it in the
 * transition that makes it, and it never reaches this check.
 */
export declare const getPerpSolvencyDust: (state: PerpState, price: number) => number;
/**
 * Whether `side`'s profit is covered: its cover reaches (1 - tolerance) of
 * that profit, less getPerpSolvencyDust. The single solvency decision, shared
 * by the assert below and the engine's open check, so a book the assert lets
 * through cannot then refuse every open on that side until the next tick.
 */
export declare const isPerpSideSolvent: (side: PerpDirection, state: PerpState, price: number, tolerance?: number) => boolean;
/**
 * Row-level sanity for one stored position. Extracted from
 * assertPerpStateNumbers (which still calls it, so the two can never drift)
 * because callers that touch a SINGLE row need the same rules before they act
 * on it — notably the engine, which must reject a corrupt row BEFORE closing
 * it or pricing a fee against it. Both operations read entryPrice through
 * getUnrealizedEquity, which silently returns 0 for a non-positive entry
 * price: a corrupt row would otherwise mark as flat and pay out its full
 * cost basis no matter where the oracle actually is.
 */
export declare const assertPerpPositionNumbers: (position: PerpPosition, label?: string) => void;
/**
 * Structural / numeric sanity for a whole state: finite non-negative pools, a
 * positive price, and every row passing assertPerpPositionNumbers.
 *
 * Exported separately from assertPerpStateSolvent because the two answer
 * different questions and belong at different points in a transition.
 * SOLVENCY is a property the risk transitions are allowed to REPAIR —
 * processLiquidations and applyADL exist precisely to bring an insolvent book
 * back to factor 1, so asserting it on their input would fail closed on the
 * exact states they are there to fix. STRUCTURE is not repairable and must
 * hold going IN: a malformed row that reaches processLiquidations/applyADL
 * can be zeroed or removed by them, after which the post-transition assert
 * inspects a state the corrupt row has already left and passes.
 */
export declare const assertPerpStateNumbers: (state: PerpState, price: number) => void;
/**
 * Fail closed before a PERP state is persisted or used for payouts.
 *
 * isPerpSideSolvent decides; the factor only words the error. Positive
 * Infinity is the valid no-profit case. Negative Infinity means the opposing
 * pool cannot even reserve the other side's current position values, by more
 * than float dust.
 */
export declare const assertPerpStateSolvent: (state: PerpState, price: number, tolerance?: number) => void;
/**
 * Immediate funding-safety containment.
 *
 * Funding can increase a receiving side's existing mark-to-market profit.
 * Re-run ADL at the unchanged oracle price, then validate the corrected state
 * before the caller builds any persistence queries.
 *
 * A factor-zero ADL explicitly settles the position's retained cost basis
 * from its own pool. Callers must mirror each returned settlement with the
 * corresponding user payout before persisting the reduced pool.
 */
export declare const applyFundingWithSolvency: (state: PerpState, fundingRate: number, price: number) => {
    fundedState: PerpState;
    state: {
        pool: {
            L: number;
            S: number;
        };
        positions: PerpPosition[];
    };
    adlFactorLong: number;
    adlFactorShort: number;
    settled: AdlSettlement[];
    crossSideTransfer: number;
};
