// Written by scripts/types.ts from src/ (pnpm --filter @hrizzup/market-engine types). Do not edit.
/**
 * The perp's engine, as plain calculation (PLAN.md step 3.4a): opening and closing a position,
 * a new price (liquidations, then winners scaled down if the pool runs short) and hourly funding.
 *
 * Manifold's perps maths (`manifold/perps/`) gives the pieces; Manifold's server combines them
 * inside each database transaction (`backend/shared/src/perps/engine.ts` at commit 79997aa:
 * `executePerpTrade`, `executePerpClose`, `applyOracleUpdate`, `runFunding`). This file is that
 * combination with the database left out: the same steps in the same order, the same refusals,
 * returning the new book and the play money to move. The ledger writes the moves as its
 * double-entry lines; the money tests (`money.test.ts`) and the simulation prove none is created
 * or lost.
 *
 * Left out, besides the database: Manifold's bans, unique-trader bonuses, request keys and
 * events (the books keep their own), its API-key fee channel (never used: Hrizzup has no trading
 * by API key) and its other price feeds.
 *
 * Every function takes the time as `now`; nothing reads the clock.
 */
import { type PerpState } from '../manifold/perps/amm.ts';
import type { PerpDirection, PerpPosition } from '../manifold/perps/position.ts';
import type { PerpTradingMode } from '../manifold/perps/trading-mode.ts';
import { type PerpSettings } from './settings.ts';
/** Everything the engine needs to know about the perp between steps. */
export type PerpBook = {
    /** The perp's id, which every position carries. */
    contractId: string;
    /** Where the price comes from (the stand-in's `feedId` until step 3.4b). */
    feedId: string;
    /** The two pools and the open positions. */
    state: PerpState;
    /** The last price applied, which trades fill at, and when it was published. */
    price: number;
    priceTime: number;
    /** When the perp opened: its first funding comes a full period later. */
    createdTime: number;
    /** When funding last ran, or undefined before the first time. */
    lastFundingTime: number | undefined;
    /**
     * Why trading is paused, when a new price couldn't be applied without leaving the pools short
     * (Manifold's "solvency halt"): the price moves on, the pools and positions don't, and trading
     * stays paused until a later price applies cleanly. Null when trading isn't paused.
     */
    halt: string | null;
};
/** Play money the ledger moves for one step, always between one person and the perp's pools. */
export type PerpMove = {
    userId: string;
    /** Into the pools: `margin` and `fee`. Out of them, to the person: `payout`. */
    kind: 'margin' | 'fee' | 'payout';
    /** Never below zero. */
    amount: number;
};
export type PerpRefusal = {
    code: 'trading_off' | 'paused' | 'stale_price' | 'not_next_price' | 'bad_request' | 'leverage_too_high' | 'fee_too_high' | 'size_fee_unpriceable' | 'insufficient_balance' | 'exposure_cap' | 'no_position' | 'position_changed' | 'insolvent';
    message: string;
};
export type PerpRefused = {
    ok: false;
    refusal: PerpRefusal;
};
/** The book a new perp starts with: the house's subsidy in each pool, no positions. */
export declare const newPerpBook: (args: {
    contractId: string;
    feedId: string;
    settings: PerpSettings;
    price: number;
    priceTime: number;
    now: number;
}) => PerpBook;
export type PerpOpenRequest = {
    userId: string;
    direction: PerpDirection;
    /** The trader's own money put in (Manifold's `mana`). */
    margin: number;
    leverage: number;
    /** When the order was placed: it fills only at a price published after this. */
    placedTime: number;
    /** The most fee the trader accepts; needed only while the size fee is on. */
    maxFee?: number;
};
export type PerpOpened = {
    ok: true;
    book: PerpBook;
    position: PerpPosition;
    fee: number;
    /** A flip first closes the trader's other side; this is what that close paid. */
    closePayout: number;
    moves: PerpMove[];
};
/**
 * Opens a position, or adds to one, at the book's price (Manifold's `executePerpTrade`). Holding
 * the other side first closes it, in the same step ("a flip"), and its payout can pay for this.
 */
export declare const openPerpPosition: (args: {
    book: PerpBook;
    settings: PerpSettings;
    tradingMode: PerpTradingMode;
    request: PerpOpenRequest;
    /** The trader's balance before this step. */
    balance: number;
    now: number;
}) => PerpOpened | PerpRefused;
export type PerpCloseRequest = {
    userId: string;
    direction: PerpDirection;
    /** The share of the position to close: 1 for all of it, else at least 1%. */
    fraction: number;
    /** For a part-close: the size the trader saw, so a position that moved since isn't cut. */
    expectedSize?: number;
    placedTime: number;
};
export type PerpClosed = {
    ok: true;
    book: PerpBook;
    payout: number;
    /** The share actually closed: a remainder too small to keep closes it all. */
    fraction: number;
    remainingPosition: PerpPosition | null;
    moves: PerpMove[];
};
/** Closes all or part of a position at the book's price (Manifold's `executePerpClose`). */
export declare const closePerpPosition: (args: {
    book: PerpBook;
    settings: PerpSettings;
    tradingMode: PerpTradingMode;
    request: PerpCloseRequest;
    now: number;
}) => PerpClosed | PerpRefused;
export type PerpPriceApplied = {
    book: PerpBook;
    /** Positions closed by liquidation: their margin stays in the pools, nothing is paid. */
    liquidated: PerpPosition[];
    /** How far winners were scaled down on each side (1: not at all). */
    adlFactorLong: number;
    adlFactorShort: number;
    /** Winners scaled down to nothing are settled: paid what remains of their margin. */
    moves: PerpMove[];
};
/**
 * A new price (Manifold's `applyOracleUpdate` inside `runOracleUpdate`): liquidations, then, if
 * the pools can't pay every winner, winners scaled down. Liquidations and scaling run whatever the
 * off switch says, so positions always settle. If the result still leaves the pools short, the
 * price moves on but the pools and positions don't, and trading pauses (`PerpBook.halt`) until a
 * later price applies cleanly, as on Manifold.
 */
export declare const applyPerpPrice: (args: {
    book: PerpBook;
    price: number;
    priceTime: number;
}) => PerpPriceApplied;
export type PerpFundingApplied = {
    ok: true;
    book: PerpBook;
    fundingRate: number;
    moves: PerpMove[];
}
/** Not due, paused, or (`reason`) the funded book couldn't be made solvent: nothing changes. */
 | {
    ok: false;
    reason: 'not_due' | 'paused' | 'stale_price' | 'insolvent';
};
/**
 * Funding, once a period (Manifold's `runFunding`): the more crowded side pays the other, in
 * proportion to how lopsided the two sides' open positions are; then winners are scaled down if
 * that left the pools short. No money leaves the pools unless a winner is settled.
 */
export declare const applyPerpFunding: (args: {
    book: PerpBook;
    settings: PerpSettings;
    now: number;
}) => PerpFundingApplied;
