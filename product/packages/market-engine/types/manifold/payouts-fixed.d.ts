// Written by scripts/types.ts from src/ (pnpm --filter @hrizzup/market-engine types). Do not edit.
import type { Answer } from './answer.ts';
import type { CPMMContract } from './contract.ts';
import type { ContractMetric } from './contract-metric.ts';
import type { LiquidityProvision } from './liquidity-provision.ts';
import type { PayoutInfo } from './payouts.ts';
export declare const getFixedCancelPayouts: (contractMetrics: ContractMetric[], liquidities: LiquidityProvision[]) => PayoutInfo;
export declare const getStandardFixedPayouts: (outcome: string, // Will be 'YES' or 'NO'
contract: CPMMContract, contractMetrics: ContractMetric[], liquidities: LiquidityProvision[]) => PayoutInfo;
export declare const getMultiFixedPayouts: (answers: Answer[], resolutions: {
    [answerId: string]: number;
}, contractMetrics: ContractMetric[], liquidities: LiquidityProvision[], contractSubsidyPool: number) => PayoutInfo;
export declare const getIndependentMultiYesNoPayouts: (answer: Answer, outcome: "YES" | "NO", contractMetrics: ContractMetric[], liquidities: LiquidityProvision[], contractSubsidyPoolShare: number) => PayoutInfo;
export declare const getLiquidityPoolPayouts: (contract: CPMMContract, outcome: string, liquidities: LiquidityProvision[]) => {
    userId: string;
    payout: number;
}[];
export declare const getIndependentMultiLiquidityPoolPayouts: (answer: Answer, resolution: number, liquidities: LiquidityProvision[], contractSubsidyPoolShare: number) => {
    userId: string;
    payout: number;
}[];
export declare const getMultiLiquidityPoolPayouts: (answers: Answer[], resolutions: {
    [answerId: string]: number;
}, liquidities: LiquidityProvision[], contractSubsidyPool: number) => {
    userId: string;
    payout: number;
}[];
export declare const getMktFixedPayouts: (contract: CPMMContract, contractMetrics: ContractMetric[], liquidities: LiquidityProvision[], resolutionProbability: number) => PayoutInfo;
export declare const getIndependentMultiMktPayouts: (answer: Answer, contractMetrics: ContractMetric[], liquidities: LiquidityProvision[], resolutionProbability: number, contractSubsidyPoolShare: number) => PayoutInfo;
export declare const getLiquidityPoolProbPayouts: (contract: CPMMContract, outcomeProbs: {
    [outcome: string]: number;
}, liquidities: LiquidityProvision[]) => {
    userId: string;
    payout: number;
}[];
