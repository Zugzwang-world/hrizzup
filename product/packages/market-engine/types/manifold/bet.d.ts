// Written by scripts/types.ts from src/ (pnpm --filter @hrizzup/market-engine types). Do not edit.
import type { Fees } from './fees.ts';
/************************************************

supabase status: columns exist for
  userId: text
  createdTime: timestamp (from millis)
  amount: number
  shares: number
  outcome: text
  probBefore: number
  probAfter: number
  isRedemption: boolean
  visibility: text

*************************************************/
export type Bet = {
    id: string;
    userId: string;
    contractId: string;
    answerId?: string;
    createdTime: number;
    updatedTime?: number;
    amount: number;
    loanAmount?: number;
    outcome: string;
    shares: number;
    probBefore: number;
    probAfter: number;
    fees: Fees;
    isApi?: boolean;
    isRedemption: boolean;
    isRebalance?: boolean;
    /** @deprecated */
    challengeSlug?: string;
    replyToCommentId?: string;
    betGroupId?: string;
} & Partial<LimitProps>;
export type NumericBet = Bet & {
    value: number;
    allOutcomeShares: {
        [outcome: string]: number;
    };
    allBetAmounts: {
        [outcome: string]: number;
    };
};
export type LimitBet = Bet & LimitProps;
type LimitProps = {
    orderAmount: number;
    limitProb: number;
    isFilled: boolean;
    isCancelled: boolean;
    fills: fill[];
    expiresAt?: number;
    silent?: boolean;
};
export type fill = {
    matchedBetId: string | null;
    amount: number;
    shares: number;
    timestamp: number;
    fees?: Fees;
    isSale?: boolean;
};
export type maker = {
    bet: LimitBet;
    amount: number;
    shares: number;
    timestamp: number;
};
export declare const getNewBetId: () => `${string}-${string}-${string}-${string}-${string}`;
export {};
