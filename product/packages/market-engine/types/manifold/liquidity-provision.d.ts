// Written by scripts/types.ts from src/ (pnpm --filter @hrizzup/market-engine types). Do not edit.
export type LiquidityProvision = {
    id: string;
    userId: string;
    contractId: string;
    createdTime: number;
    isAnte?: boolean;
    answerId?: string;
    amount: number;
    withdrawnBy?: string;
    /** @deprecated change in constant k after provision*/
    liquidity?: number;
    pool?: {
        [outcome: string]: number;
    };
};
