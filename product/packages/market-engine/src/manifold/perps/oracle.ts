// Ours, in place of Manifold's `common/src/perps/oracle.ts` (README, "Ours, in place of
// Manifold's"). The perps maths imports only the `OraclePoint` type from it (`orders.ts`), so
// that is all this file holds, with Manifold's own text. Manifold's file is the real price
// feed's: how fresh a price must be and the median of several exchanges. It comes with the
// real Bitcoin price (PLAN.md step 3.4b), replacing this one.

export type OraclePoint = {
  /**
   * Feed-defined effective timestamp used to order source observations. The
   * database separately records when Manifold first published the immutable
   * row, because delayed/batched providers can make those times differ.
   */
  ts: number;
  price: number;
  /**
   * Provider-declared timestamp for the source dataset used to derive this
   * observation. This may equal `ts`; it is separate attribution metadata.
   */
  sourceTs?: number;
};
