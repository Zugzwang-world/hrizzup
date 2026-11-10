/**
 * A small ledger for the perp's money tests (`money.test.ts`, `simulation.test.ts`), standing in
 * for the books (1.7b's double-entry ledger, which the rest of step 3.4a extends to the perp).
 *
 * It holds every balance: each trader's, the house's, and what the perp holds (its "escrow").
 * The perp opens with the house's subsidy, and every step's moves are applied as pairs, out of one
 * account and into another, the way the books write them. After every step `check()` proves:
 *
 * - **each step moves exactly its money:** the change in the two pools equals the step's moves
 *   in and out (to a billionth of the pools' size), so the maths neither makes nor loses any;
 * - **the pools hold exactly the perp's money:** escrow = long pool + short pool (Manifold's own
 *   check, `isPerpEscrowBalanced`, at its own tolerance for floating point);
 * - **the ledger's own sums hold:** all the balances add up to the start (true by construction,
 *   since each move is a pair; it guards this ledger, not the maths);
 * - **nobody goes below zero, and neither pool does;**
 * - **every winner can be paid:** the pools cover every position's claim (Manifold's
 *   `assertPerpStateSolvent`), unless the book is paused, when nothing moved.
 */
import { assertPerpStateNumbers, assertPerpStateSolvent } from '../manifold/perps/amm.ts';
import { getPerpEscrowTolerance, isPerpEscrowBalanced } from '../manifold/perps/escrow.ts';
import type { PerpBook, PerpMove } from './engine.ts';

export const HOUSE = 'house';

export class TestLedger {
  readonly balances = new Map<string, number>();
  escrow = 0;
  readonly start: number;
  /** Every move applied, in order. */
  readonly moves: PerpMove[] = [];
  /** The pools and the escrow at the last check, for the step-by-step comparison. */
  private lastPools: number;
  private lastEscrow: number;

  constructor(traders: Record<string, number>, subsidy: number, houseBalance = 1_000_000) {
    this.balances.set(HOUSE, houseBalance - subsidy);
    this.escrow = subsidy;
    for (const [id, amount] of Object.entries(traders)) this.balances.set(id, amount);
    this.start = this.total();
    this.lastPools = subsidy;
    this.lastEscrow = subsidy;
  }

  balance(id: string) {
    return this.balances.get(id) ?? 0;
  }

  total() {
    let sum = this.escrow;
    for (const amount of this.balances.values()) sum += amount;
    return sum;
  }

  /** Applies one step's moves as pairs: margin and fee into the perp, payouts out of it. */
  apply(moves: readonly PerpMove[]) {
    for (const move of moves) {
      if (!(move.amount >= 0) || !Number.isFinite(move.amount))
        throw new Error(`a ${move.kind} for ${move.userId} of ${move.amount}`);
      const sign = move.kind === 'payout' ? 1 : -1;
      this.balances.set(move.userId, this.balance(move.userId) + sign * move.amount);
      this.escrow -= sign * move.amount;
      this.moves.push(move);
    }
  }

  /**
   * Everything the money tests promise, checked against the book after a step. Plain
   * comparisons, with the message built only on a failure, since the simulation checks hundreds
   * of thousands of steps.
   */
  check(book: PerpBook, label: string | (() => string) = '') {
    const fail = (what: string) => {
      throw new Error(`${typeof label === 'function' ? label() : label}: ${what}`);
    };
    const { L, S } = book.state.pool;
    const poolsMoved = L + S - this.lastPools;
    const movesIn = this.escrow - this.lastEscrow;
    if (!(Math.abs(poolsMoved - movesIn) <= 1e-9 * Math.max(1, L + S, this.lastPools)))
      fail(`the pools moved ${poolsMoved} but the step's moves put in ${movesIn}`);
    this.lastPools = L + S;
    this.lastEscrow = this.escrow;
    if (!(Math.abs(this.total() - this.start) < 1e-9 * Math.max(1, Math.abs(this.start))))
      fail(`money created or lost: ${this.total()} against ${this.start} at the start`);
    const snapshot = { ledgerBalance: this.escrow, poolLong: L, poolShort: S };
    if (!isPerpEscrowBalanced(snapshot))
      fail(
        `escrow ${this.escrow} against pools ${L} + ${S} (allowed ${getPerpEscrowTolerance(snapshot)})`,
      );
    if (!(L >= 0) || !(S >= 0)) fail(`a pool below zero: ${L}, ${S}`);
    for (const [id, amount] of this.balances)
      if (!(amount >= -1e-9)) fail(`${id}'s balance below zero: ${amount}`);
    assertPerpStateNumbers(book.state, book.price);
    if (book.halt === null) assertPerpStateSolvent(book.state, book.price);
  }
}
