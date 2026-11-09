// Written by scripts/types.ts from src/ (pnpm --filter @hrizzup/market-engine types). Do not edit.
import { type Answer } from './answer.ts';
import type { Bet } from './bet.ts';
import { type MarginalBet } from './calculate-metrics.ts';
import { type BinaryContract, type Contract, type MultiContract, type PseudoNumericContract, type StonkContract } from './contract.ts';
import type { ContractMetric } from './contract-metric.ts';
export declare function getProbability(contract: BinaryContract | PseudoNumericContract | StonkContract): number;
export declare function getDisplayProbability(contract: BinaryContract | PseudoNumericContract | StonkContract): number;
export declare function getInitialProbability(contract: BinaryContract | PseudoNumericContract | StonkContract): number;
export declare function getOutcomeProbability(contract: Contract, outcome: string): number;
export declare function getAnswerProbability(contract: MultiContract, answerId: string): number;
export declare function getInitialAnswerProbability(contract: MultiContract, answer: Answer): number | undefined;
export declare function getOutcomeProbabilityAfterBet(contract: Contract, outcome: string, bet: number): number;
export declare function calculateSharesBought(contract: Contract, outcome: string, amount: number): number;
export declare function calculatePayout(contract: Contract, bet: Bet, outcome: string): number;
export declare function resolvedPayout(contract: Contract, bet: Bet): number;
export declare function calculateTotalSpentAndShares(bets: MarginalBet[], initialTotalSpent?: {
    [outcome: string]: number;
}, initialTotalShares?: {
    [outcome: string]: number;
}): {
    totalSpent: {
        [outcome: string]: number;
    };
    totalShares: {
        [outcome: string]: number;
    };
};
export declare function getSimpleCpmmInvested(yourBets: Bet[]): number;
export declare function getInvested(contract: Contract, yourBets: Bet[]): number;
export declare function getProfitMetrics(contract: Contract, yourBets: Bet[]): {
    profit: number;
    profitPercent: number;
    totalAmountInvested: number;
    totalAmountSold: number;
    payout: number;
};
export declare function getCpmmShares(yourBets: Bet[]): {
    totalShares: {
        [outcome: string]: number;
    };
    hasShares: boolean;
    hasYesShares: boolean;
    hasNoShares: boolean;
};
export declare function getCpmmMultiShares(yourBets: Bet[]): {
    hasShares: boolean;
    sharesByAnswerId: {
        [x: string]: {
            totalShares: {
                [outcome: string]: number;
            };
            hasShares: boolean;
            hasYesShares: boolean;
            hasNoShares: boolean;
        };
    };
};
export declare const getContractBetMetrics: (contract: Contract, yourBets: Bet[], answerId?: string) => Omit<ContractMetric, "id" | "from" | "userId" | "loan" | "marginLoan">;
export declare const getContractBetMetricsPerAnswerWithoutLoans: (contract: Contract, bets: Bet[], answers: Answer[] | undefined, now: number) => ContractMetric[];
export declare function getContractBetNullMetrics(): ContractMetric;
