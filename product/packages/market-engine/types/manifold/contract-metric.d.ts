// Written by scripts/types.ts from src/ (pnpm --filter @hrizzup/market-engine types). Do not edit.
export type ContractMetric = {
    id: number;
    userId: string;
    contractId: string;
    answerId: string | null;
    lastBetTime: number;
    lastProb: number | null;
    hasNoShares: boolean;
    hasShares: boolean;
    hasYesShares: boolean;
    invested: number;
    loan: number;
    marginLoan: number;
    maxSharesOutcome: string | null;
    totalShares: {
        [outcome: string]: number;
    };
    totalSpent: {
        [outcome: string]: number;
    } | undefined;
    payout: number;
    totalAmountSold: number;
    totalAmountInvested: number;
    profit: number;
    profitPercent: number;
    previousProfit?: number;
    from: {
        [period: string]: {
            profit: number;
            profitPercent: number;
            invested: number;
            prevValue: number;
            value: number;
        };
    } | undefined;
    userUsername?: string;
    userName?: string;
    userAvatarUrl?: string;
};
export type ContractMetricsByOutcome = Record<string, ContractMetric[]>;
export declare const isSummary: (metric: ContractMetric | Omit<ContractMetric, "id">) => boolean;
export declare const getMaxSharesOutcome: (metric: ContractMetric | undefined) => string | undefined;
