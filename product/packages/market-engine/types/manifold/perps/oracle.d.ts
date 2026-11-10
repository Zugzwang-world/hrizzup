// Written by scripts/types.ts from src/ (pnpm --filter @hrizzup/market-engine types). Do not edit.
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
