// Written by scripts/types.ts from src/ (pnpm --filter @hrizzup/market-engine types). Do not edit.
export type PerpEscrowSnapshot = {
    ledgerBalance: number;
    poolLong: number;
    poolShort: number;
};
export declare const getPerpEscrowTolerance: ({ ledgerBalance, poolLong, poolShort, }: PerpEscrowSnapshot) => number;
export declare const getPerpEscrowDifference: ({ ledgerBalance, poolLong, poolShort, }: PerpEscrowSnapshot) => number;
export declare const isPerpEscrowBalanced: (snapshot: PerpEscrowSnapshot) => boolean;
