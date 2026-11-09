// Written by scripts/types.ts from src/ (pnpm --filter @hrizzup/market-engine types). Do not edit.
import { type Bet } from './bet.ts';
import type { Contract } from './contract.ts';
import type { ContractMetric } from './contract-metric.ts';
export declare const getBinaryRedeemableAmountFromContractMetric: (contractMetric: Omit<ContractMetric, "id">) => {
    shares: number;
    loanPayment: number;
    netAmount: number;
};
export declare const getRedemptionBets: (contract: Contract, shares: number, prob: number, answerId: string | undefined, userId: string, now: number) => Bet[];
