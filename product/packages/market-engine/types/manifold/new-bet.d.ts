// Written by scripts/types.ts from src/ (pnpm --filter @hrizzup/market-engine types). Do not edit.
import { type Answer } from './answer.ts';
import type { Bet, LimitBet } from './bet.ts';
import { type CpmmState } from './calculate-cpmm.ts';
import { type BinaryContract, type CPMMMultiContract, type MultiContract, type PseudoNumericContract, type StonkContract } from './contract.ts';
export type CandidateBet<T extends Bet = Bet> = Omit<T, 'id' | 'userId'>;
export type BetInfo = {
    newBet: CandidateBet;
    newPool?: {
        [outcome: string]: number;
    };
    newTotalLiquidity?: number;
    newP?: number;
};
export declare const computeCpmmBet: (cpmmState: CpmmState, outcome: "YES" | "NO", initialBetAmount: number, limitProb: number | undefined, unfilledBets: LimitBet[], balanceByUserId: {
    [userId: string]: number;
}, limitProbs?: {
    max: number;
    min: number;
}, now?: number) => {
    orderAmount: number;
    amount: number;
    shares: number;
    isFilled: boolean;
    fills: import("./bet.ts").fill[];
    probBefore: number;
    probAfter: number;
    makers: {
        bet: LimitBet;
        amount: number;
        shares: number;
        timestamp: number;
    }[];
    ordersToCancel: LimitBet[];
    fees: import("./fees.ts").Fees;
    pool: {
        [outcome: string]: number;
    };
    p: number;
};
export declare const getBinaryCpmmBetInfo: (contract: BinaryContract | PseudoNumericContract | StonkContract, outcome: "YES" | "NO", betAmount: number, limitProb: number | undefined, unfilledBets: LimitBet[], balanceByUserId: {
    [userId: string]: number;
}, expiresAt: number | undefined, expiresMillisAfter: number | undefined, now: number) => {
    newBet: CandidateBet<Bet>;
    newPool: {
        [outcome: string]: number;
    };
    newP: number;
    makers: {
        bet: LimitBet;
        amount: number;
        shares: number;
        timestamp: number;
    }[];
    ordersToCancel: LimitBet[];
};
export declare const getNewMultiCpmmBetInfo: (contract: MultiContract, answers: Answer[], answer: Answer, outcome: "YES" | "NO", betAmount: number, limitProb: number | undefined, unfilledBets: LimitBet[], balanceByUserId: {
    [userId: string]: number;
}, expiresAt?: number, expiresMillisAfter?: number) => {
    newBet: CandidateBet<Bet>;
    newPool: {
        YES: number;
        NO: number;
    };
    makers: {
        bet: LimitBet;
        amount: number;
        shares: number;
        timestamp: number;
    }[];
    ordersToCancel: LimitBet[];
    otherBetResults: {
        bet: CandidateBet<Bet>;
        takers: import("./bet.ts").fill[];
        makers: {
            bet: LimitBet;
            amount: number;
            shares: number;
            timestamp: number;
        }[];
        ordersToCancel: LimitBet[];
        outcome: "YES" | "NO";
        cpmmState: {
            p: number;
            pool: {
                YES: number;
                NO: number;
            };
            collectedFees: import("./fees.ts").Fees;
        };
        answer: Answer;
        totalFees: import("./fees.ts").Fees;
        iteration?: number;
    }[];
} | {
    newBet: CandidateBet<Bet>;
    newPool: {
        [outcome: string]: number;
    };
    makers: {
        bet: LimitBet;
        amount: number;
        shares: number;
        timestamp: number;
    }[];
    ordersToCancel: LimitBet[];
};
export declare const getNewMultiCpmmBetsInfo: (contract: MultiContract, answers: Answer[], answersToBuy: Answer[], outcome: "YES", betAmount: number, limitProb: number | undefined, unfilledBets: LimitBet[], balanceByUserId: {
    [userId: string]: number;
}, expiresAt?: number) => {
    newBet: CandidateBet<Bet>;
    newPool: {
        YES: number;
        NO: number;
    };
    makers: {
        bet: LimitBet;
        amount: number;
        shares: number;
        timestamp: number;
    }[];
    ordersToCancel: LimitBet[];
    otherBetResults: {
        bet: CandidateBet<Bet>;
        takers: import("./bet.ts").fill[];
        makers: {
            bet: LimitBet;
            amount: number;
            shares: number;
            timestamp: number;
        }[];
        ordersToCancel: LimitBet[];
        outcome: "YES" | "NO";
        cpmmState: {
            p: number;
            pool: {
                YES: number;
                NO: number;
            };
            collectedFees: import("./fees.ts").Fees;
        };
        answer: Answer;
        totalFees: import("./fees.ts").Fees;
        iteration?: number;
    }[];
}[];
export declare const getBetDownToOneMultiBetInfo: (contract: CPMMMultiContract, answers: Answer[], unfilledBets: LimitBet[], balanceByUserId: {
    [userId: string]: number;
}) => {
    betResults: {
        bet: CandidateBet<Bet>;
        takers: import("./bet.ts").fill[];
        makers: {
            bet: LimitBet;
            amount: number;
            shares: number;
            timestamp: number;
        }[];
        totalFees: import("./fees.ts").Fees;
        cpmmState: {
            pool: {
                [outcome: string]: number;
            };
            p: number;
            collectedFees: import("./fees.ts").Fees;
        };
        ordersToCancel: LimitBet[];
        answer: Answer;
        iteration?: number;
    }[];
    extraMana: number;
};
