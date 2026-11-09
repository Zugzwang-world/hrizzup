// Written by scripts/types.ts from src/ (pnpm --filter @hrizzup/market-engine types). Do not edit.
import type { Bet } from './bet.ts';
import type { CPMMContract, MultiContract } from './contract.ts';
export declare function calculateFixedPayout(contract: CPMMContract, bet: Bet, outcome: string): number;
export declare function calculateFixedCancelPayout(bet: Bet): number;
export declare function calculateStandardFixedPayout(bet: Bet, outcome: string): number;
export declare function calculateFixedPayoutMulti(contract: MultiContract, bet: Bet, outcome: string): number;
