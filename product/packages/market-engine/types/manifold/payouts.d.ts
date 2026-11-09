// Written by scripts/types.ts from src/ (pnpm --filter @hrizzup/market-engine types). Do not edit.
import type { Answer } from './answer.ts';
import { type Contract, type CPMMContract, type CPMMMultiContract } from './contract.ts';
import type { ContractMetric } from './contract-metric.ts';
import type { LiquidityProvision } from './liquidity-provision.ts';
export type Payout = {
    userId: string;
    payout: number;
    deposit?: number;
};
export declare const getLoanPayouts: (_contractMetrics: ContractMetric[], _answerId?: string) => Payout[];
export declare const groupPayoutsByUser: (payouts: Payout[]) => {
    [x: string]: number;
};
export type PayoutInfo = {
    traderPayouts: Payout[];
    liquidityPayouts: Payout[];
};
export declare const getPayouts: (outcome: string | undefined, contract: Contract, contractMetrics: ContractMetric[], liquidities: LiquidityProvision[], resolutions?: {
    [outcome: string]: number;
}, resolutionProbability?: number, answerId?: string | undefined) => PayoutInfo;
export declare const getFixedPayouts: (outcome: string | undefined, contract: CPMMContract, contractMetrics: ContractMetric[], liquidities: LiquidityProvision[], resolutionProbability: number) => PayoutInfo;
export declare const getIndependentMultiFixedPayouts: (answer: Answer, outcome: string | undefined, contract: CPMMMultiContract, contractMetrics: ContractMetric[], liquidities: LiquidityProvision[], resolutionProbability: number) => PayoutInfo;
export declare function getPayoutInfo(contract: Contract, metric: ContractMetric, answer: Answer | undefined, now: number): {
    canSell: boolean;
    won: boolean;
    payoutWord: string;
};
