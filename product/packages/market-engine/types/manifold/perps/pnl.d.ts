// Written by scripts/types.ts from src/ (pnpm --filter @hrizzup/market-engine types). Do not edit.
import { getPositionValue, getUnrealizedEquity } from './amm.ts';
import type { PerpDirection, PerpPosition } from './position.ts';
export { getPositionValue, getUnrealizedEquity };
/**
 * Signed mana a position's value moves at the next funding event, at the
 * given price: positive = the position receives funding, negative = it
 * pays. Mirrors applyFunding exactly: the crowded side's size AND cost
 * basis scale by (1−f) — so a payer in profit also forfeits f of its
 * unrealized gains, not just f of margin — and the thin side scales up by
 * the transfer re-based on its own pool (f·L/S, resp. |f|·S/L), so with
 * imbalanced pools receivers earn more per mana of margin than payers pay.
 */
export declare const fundingPerPeriod: (position: Pick<PerpPosition, "direction" | "size" | "costBasis" | "entryPrice"> & {
    direction: PerpDirection;
}, price: number, fundingRate: number, poolLong: number, poolShort: number) => number;
/** Paper π: (P - Pe)/Pe · q (signed by direction). */
export declare const getUnrealizedPnl: (position: PerpPosition, price: number) => number;
/**
 * Profit as the user perceives it:
 *   currentValue - originalMargin - openingFees
 * Funding haircut/bonus is absorbed into `currentValue`; user just sees the
 * delta against what they put in.
 */
export declare const getUserFacingPnl: (position: PerpPosition, price: number) => number;
export declare const getPerpPositionTotalCost: (position: Pick<PerpPosition, "originalCostBasis" | "takerFeeCostBasis">) => number;
/**
 * The fields the PnL solvers read: a stored row, or a preview of the row a
 * trade would produce.
 */
export type PerpPnlPositionInput = Pick<PerpPosition, 'direction' | 'size' | 'costBasis' | 'originalCostBasis' | 'takerFeeCostBasis' | 'entryPrice'>;
/**
 * Oracle/close price required to reach a user-facing PnL target. The target
 * is net of all opening/add fees already paid; future funding is necessarily
 * excluded. Returns undefined when the inputs cannot describe a valid target.
 */
export declare const getPerpPriceForUserFacingPnl: (position: PerpPnlPositionInput, targetPnl: number) => number | undefined;
export type PerpProfitScenario = {
    /** Net return on the cash committed: margin plus opening/add fees. */
    ret: number;
    /** Oracle price at which the position card reads exactly +ret. */
    price: number;
    /** User-facing PnL at that price — ret × the cash committed. */
    pnl: number;
};
/**
 * The trade panel's profit ladder for the position a trade RESULTS in: the
 * row the position card will show once the trade lands. Each tier is a NET
 * return on the cash committed to that row — margin plus every opening/add
 * fee, the denominator of getUserFacingPnlPercent — so at the solved price
 * the card reads exactly "+ret%" and exactly `pnl`.
 *
 * On a fresh open (or the new leg of a flip) the row is just the tranche. On
 * an ADD it is the merged row, held margin and fees included — the only base
 * the card can show, and why this takes a position rather than a margin: a
 * "+25% on the tranche" target would mix the tranche's cash with the merged
 * entry price. A tier the row already exceeds at the mark is dropped, since
 * reaching it from here is a loss, not a profit scenario (only an add can
 * start past one; a fresh row starts at −fee). Closing is free; future
 * funding is unknowable here and excluded. Fails closed (empty) on a mark
 * or row it cannot price.
 */
export declare const getPerpProfitScenarios: (position: PerpPnlPositionInput, markPrice: number, returnTiers: readonly number[]) => PerpProfitScenario[];
/**
 * Realized PnL shown on close receipts, history, and ledger rows. Settlement
 * payout already contains every funding transfer, so compare it with the
 * margin the user actually deposited rather than the funding-scaled basis.
 */
export declare const getUserFacingPnlFromPayout: (payout: number, originalCostBasis: number, takerFeeCostBasis?: number) => number;
/** Percentage form, using total cash committed as the denominator. */
export declare const getUserFacingPnlPercent: (position: PerpPosition, price: number) => number;
