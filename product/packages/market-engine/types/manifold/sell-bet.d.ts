// Written by scripts/types.ts from src/ (pnpm --filter @hrizzup/market-engine types). Do not edit.
import { type Answer } from './answer.ts';
import type { Bet, LimitBet } from './bet.ts';
import { type ArbitrageBetArray } from './calculate-cpmm-arbitrage.ts';
import { type Contract, type CPMMContract, type MarketContract, type MultiContract } from './contract.ts';
export type CandidateBet<T extends Bet> = Omit<T, 'id' | 'userId' | 'userAvatarUrl' | 'userName' | 'userUsername'>;
export declare const getCpmmSellBetInfo: (shares: number, outcome: "YES" | "NO", contract: MarketContract, unfilledBets: LimitBet[], balanceByUserId: {
    [userId: string]: number;
}, answer: Answer | undefined, now: number) => {
    newBet: CandidateBet<Bet>;
    newPool: {
        [outcome: string]: number;
    };
    newP: number;
    fees: import("./fees.ts").Fees;
    makers: {
        bet: LimitBet;
        amount: number;
        shares: number;
        timestamp: number;
    }[];
    takers: {
        shares: number;
        amount: number;
        isSale: boolean;
        matchedBetId: string | null;
        timestamp: number;
        fees?: import("./fees.ts").Fees;
    }[];
    ordersToCancel: LimitBet[];
};
export declare const getCpmmMultiSellBetInfo: (contract: MultiContract, answers: Answer[], answerToSell: Answer, shares: number, outcome: "YES" | "NO", limitProb: number | undefined, unfilledBets: LimitBet[], balanceByUserId: {
    [userId: string]: number;
}, loanPaid: number) => {
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
    otherBetResults: {
        bet: CandidateBet<Bet>;
        outcome: string;
        answer: Answer;
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
    }[];
};
export declare const getCpmmMultiSellSharesInfo: (contract: MultiContract, userBetsByAnswerIdToSell: {
    [answerId: string]: Bet[];
}, unfilledBets: LimitBet[], balanceByUserId: {
    [userId: string]: number;
}, loanPaidByAnswerId: {
    [answerId: string]: number;
}) => {
    otherBetResults: {
        newBet: CandidateBet<Bet>;
        bet: CandidateBet<Bet>;
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
        takers: import("./bet.ts").fill[];
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
    newBet: CandidateBet<Bet>;
    bet: CandidateBet<Bet>;
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
}[];
export declare const getNewSellBetInfo: (newBetResult: ArbitrageBetArray[number], now: number, initialAnswers: Answer[], contract: Contract, loanPaidByAnswerId: {
    [answerId: string]: number;
}) => {
    newBet: CandidateBet<Bet>;
    bet: CandidateBet<Bet>;
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
};
export declare const getSaleResult: (contract: CPMMContract | MultiContract, shares: number, outcome: "YES" | "NO", unfilledBets: LimitBet[], balanceByUserId: {
    [userId: string]: number;
}, answer?: Answer) => {
    saleValue: number;
    buyAmount: number;
    cpmmState: {
        pool: {
            [outcome: string]: number;
        };
        p: number;
        collectedFees: import("./fees.ts").Fees;
    };
    initialProb: number;
    resultProb: number;
    probChange: number;
    fees: import("./fees.ts").Fees;
    makers: LimitBet[];
};
export declare const getSaleResultMultiSumsToOne: (contract: MultiContract, answerId: string, shares: number, outcome: "YES" | "NO", unfilledBets: LimitBet[], balanceByUserId: {
    [userId: string]: number;
}) => {
    saleValue: number;
    buyAmount: number;
    cpmmState: {
        pool: {
            [outcome: string]: number;
        };
        p: number;
        collectedFees: import("./fees.ts").Fees;
    };
    initialProb: number;
    resultProb: number;
    probChange: number;
    fees: import("./fees.ts").Fees;
    makers: LimitBet[];
};
