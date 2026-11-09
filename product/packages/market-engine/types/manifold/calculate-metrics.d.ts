// Written by scripts/types.ts from src/ (pnpm --filter @hrizzup/market-engine types). Do not edit.
import type { Dictionary } from 'lodash';
import type { Bet, LimitBet } from './bet.ts';
import { type CpmmState } from './calculate-cpmm.ts';
import { type Contract } from './contract.ts';
import { type ContractMetric } from './contract-metric.ts';
/**
 * Calculate payout from both YES and NO shares at a given probability.
 * Since YES + NO shares can be redeemed for 1 mana, having both shares
 * means you have guaranteed value from the min(yesShares, noShares) pairs
 * plus the expected value of remaining shares.
 *
 * This simplifies to: yesShares * prob + noShares * (1 - prob)
 */
export declare const calculatePayoutFromShares: (totalShares: {
    [outcome: string]: number;
}, prob: number) => number;
export declare const computeInvestmentValueCustomProb: (bets: Bet[], contract: Contract, p: number) => number;
export declare const ELASTICITY_BET_AMOUNT = 10000;
export declare const computeElasticity: (unfilledBets: LimitBet[], contract: Contract, betAmount?: number) => number;
export declare const computeBinaryCpmmElasticity: (unfilledBets: LimitBet[], cpmmState: CpmmState, betAmount: number) => number;
export declare const computeBinaryCpmmElasticityFromAnte: (ante: number, betAmount?: number) => number;
export declare const calculateMetricsByContractAndAnswer: (betsByContractId: Dictionary<Bet[]>, contractsById: Dictionary<Contract>, userId: string, currentMetrics: ContractMetric[], now: number) => {
    loan: number;
    marginLoan: number;
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
}[];
export declare const isEmptyMetric: (m: ContractMetric) => boolean;
export declare const calculateUserMetricsWithoutLoans: (contract: Contract, bets: Bet[], userId: string, now: number) => ContractMetric[];
export type MarginalBet = Pick<Bet, 'userId' | 'answerId' | 'contractId' | 'amount' | 'shares' | 'outcome' | 'createdTime' | 'loanAmount' | 'isRedemption' | 'probAfter'>;
export declare const calculateUserMetricsWithNewBetsOnly: (newBets: MarginalBet[], um: Omit<ContractMetric, "id">) => {
    loan: number;
    marginLoan: number;
    invested: number;
    totalShares: {
        [outcome: string]: number;
    };
    hasNoShares: boolean;
    hasYesShares: boolean;
    hasShares: boolean;
    maxSharesOutcome: string | null;
    lastBetTime: number;
    lastProb: number;
    totalSpent: {
        [outcome: string]: number;
    };
    payout: number;
    totalAmountSold: number;
    totalAmountInvested: number;
    profit: number;
    profitPercent: number;
    contractId: string;
    userId: string;
    answerId: string | null;
    previousProfit?: number | undefined;
    from: {
        [period: string]: {
            profit: number;
            profitPercent: number;
            invested: number;
            prevValue: number;
            value: number;
        };
    } | undefined;
    userUsername?: string | undefined;
    userName?: string | undefined;
    userAvatarUrl?: string | undefined;
};
export declare const calculateProfitMetricsAtProbOrCancel: <T extends Omit<ContractMetric, "id"> | ContractMetric>(newState: number | "CANCEL", um: T) => T & {
    payout: number;
    profit: number;
    profitPercent: number;
    previousProfit: number;
};
export declare const calculateAnswerMetricsWithNewBetsOnly: (newBets: MarginalBet[], userMetrics: Omit<ContractMetric, "id">[], contractId: string, isMultiMarket: boolean) => Omit<ContractMetric, "id">[];
export declare const getDefaultMetric: (userId: string, contractId: string, answerId: string | null) => Omit<ContractMetric, "id">;
export declare const applyMetricToSummary: <T extends Omit<ContractMetric, "id"> | ContractMetric>(metric: T, summary: T, add: boolean) => T;
export declare const calculateUpdatedMetricsForContracts: (contractsWithMetrics: {
    contract: Contract;
    metrics: ContractMetric[];
}[], useIncludedSummaryMetric?: boolean) => {
    metricsByContract: Dictionary<Omit<ContractMetric, "id">[]>;
};
export declare const calculateMetricsFromProbabilityChanges: (userMetrics: ContractMetric[], contractsById: Record<string, Contract>) => ContractMetric[];
