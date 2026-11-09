// Written by scripts/types.ts from src/ (pnpm --filter @hrizzup/market-engine types). Do not edit.
import type { Dictionary } from 'lodash';
import { type Answer } from './answer.ts';
import type { Bet, LimitBet, maker } from './bet.ts';
import { computeFills } from './calculate-cpmm.ts';
import { type Fees } from './fees.ts';
export type ArbitrageBetArray = ReturnType<typeof combineBetsOnSameAnswers>;
export declare const CPMM_MULTI_2_UNPRICED_ERROR = "This trade can't be priced accurately at these odds. Try a different amount.";
export declare const cpmmMultiTradeMissesSumToOne: (answers: Answer[], poolsAfter: {
    [answerId: string]: {
        [outcome: string]: number;
    };
}) => boolean;
export declare const poolsAfterResults: (results: {
    newBet: {
        answerId?: string;
    };
    newPool?: {
        [outcome: string]: number;
    };
    otherBetResults?: {
        answer: {
            id: string;
        };
        cpmmState: {
            pool: {
                [outcome: string]: number;
            };
        };
    }[];
}[]) => {
    [answerId: string]: {
        [outcome: string]: number;
    };
};
export declare function calculateCpmmMultiArbitrageBet(answers: Answer[], answerToBuy: Answer, outcome: 'YES' | 'NO', betAmount: number, initialLimitProb: number | undefined, unfilledBets: LimitBet[], balanceByUserId: {
    [userId: string]: number;
}, collectedFees: Fees): {
    newBetResult: {
        outcome: string;
        answer: Answer;
        takers: never[];
        makers: maker[];
        ordersToCancel: LimitBet[];
        cpmmState: {
            pool: {
                YES: number;
                NO: number;
            };
            p: number;
            collectedFees: Fees;
        };
        totalFees: {
            creatorFee: number;
            liquidityFee: number;
            platformFee: number;
        };
    };
    otherBetResults: ArbitrageBetArray;
} | {
    newBetResult: {
        outcome: string;
        answer: Answer;
        takers: import("./bet.ts").fill[];
        makers: {
            bet: LimitBet;
            amount: number;
            shares: number;
            timestamp: number;
        }[];
        totalFees: Fees;
        cpmmState: {
            pool: {
                [outcome: string]: number;
            };
            p: number;
            collectedFees: Fees;
        };
        ordersToCancel: LimitBet[];
    };
    otherBetResults: {
        outcome: string;
        answer: Answer;
        takers: import("./bet.ts").fill[];
        makers: {
            bet: LimitBet;
            amount: number;
            shares: number;
            timestamp: number;
        }[];
        totalFees: Fees;
        cpmmState: {
            pool: {
                [outcome: string]: number;
            };
            p: number;
            collectedFees: Fees;
        };
        ordersToCancel: LimitBet[];
    }[];
};
export declare function calculateCpmmMultiArbitrageYesBets(answers: Answer[], answersToBuy: Answer[], betAmount: number, limitProb: number | undefined, unfilledBets: LimitBet[], balanceByUserId: {
    [userId: string]: number;
}, collectedFees: Fees, arbVersion: 'cpmm-multi-1' | 'cpmm-multi-2'): {
    newBetResults: {
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
            collectedFees: Fees;
        };
        answer: Answer;
        totalFees: Fees;
        iteration?: number;
    }[];
    otherBetResults: {
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
            collectedFees: Fees;
        };
        answer: Answer;
        totalFees: Fees;
        iteration?: number;
    }[];
    updatedAnswers: Answer[];
};
export type PreliminaryBetResults = ReturnType<typeof computeFills> & {
    answer: Answer;
    iteration?: number;
};
export declare class CpmmMulti2InvariantError extends Error {
    details?: unknown;
    constructor(message: string, details?: unknown);
}
export declare const verifyCpmmMulti2BetResult: (betAmount: number, newBetResults: ArbitrageBetArray, otherBetResults: ArbitrageBetArray, updatedAnswers: Answer[], unfilledBets: LimitBet[]) => void;
export declare const getBetResultsAndUpdatedAnswers: (answersToBuy: Answer[], yesAmounts: number[], updatedAnswers: Answer[], limitProb: number | undefined, unfilledBets: LimitBet[], balanceByUserId: {
    [userId: string]: number;
}, collectedFees: Fees, answerIdsWithFees?: string[]) => {
    newUpdatedAnswers: {
        poolYes: number;
        poolNo: number;
        prob: number;
        id: string;
        index: number;
        contractId: string;
        userId: string;
        text: string;
        createdTime: number;
        color?: string;
        p: number;
        totalLiquidity: number;
        subsidyPool: number;
        volume: number;
        isOther?: boolean;
        resolution?: import("./contract.ts").resolution;
        resolutionTime?: number;
        resolutionProbability?: number;
        resolverId?: string;
        probChanges: {
            day: number;
            week: number;
            month: number;
        };
        loverUserId?: string;
        imageUrl?: string;
        shortText?: string;
        midpoint?: number;
    }[];
    yesBets: {
        answer: Answer;
        takers: import("./bet.ts").fill[];
        makers: {
            bet: LimitBet;
            amount: number;
            shares: number;
            timestamp: number;
        }[];
        totalFees: Fees;
        cpmmState: {
            pool: {
                [outcome: string]: number;
            };
            p: number;
            collectedFees: Fees;
        };
        ordersToCancel: LimitBet[];
    }[];
    noBuyResults: {
        noBetResults: PreliminaryBetResults[];
        extraMana: number;
    };
    updatedUnfilledBetsByAnswer: Dictionary<LimitBet[]>;
    updatedBalanceByUserId: {
        [userId: string]: number;
    };
};
export declare const combineBetsOnSameAnswers: (bets: PreliminaryBetResults[], outcome: "YES" | "NO", updatedAnswers: Answer[], collectedFees: Fees, fillsFollowingFirstAreFree?: boolean, extraFeesPerAnswer?: {
    [answerId: string]: Fees;
}) => {
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
        collectedFees: Fees;
    };
    answer: Answer;
    totalFees: Fees;
    iteration?: number;
}[];
export declare const buyNoSharesUntilAnswersSumToOne: (answers: Answer[], unfilledBets: LimitBet[], balanceByUserId: {
    [userId: string]: number;
}, collectedFees: Fees, answerIdsWithFees?: string[]) => {
    noBetResults: PreliminaryBetResults[];
    extraMana: number;
};
export declare function calculateCpmmMultiArbitrageSellNo(answers: Answer[], answerToSell: Answer, noShares: number, limitProb: number | undefined, unfilledBets: LimitBet[], balanceByUserId: {
    [userId: string]: number;
}, collectedFees: Fees): {
    newBetResult: {
        outcome: string;
        takers: import("./bet.ts").fill[];
        makers: {
            bet: LimitBet;
            amount: number;
            shares: number;
            timestamp: number;
        }[];
        totalFees: Fees;
        cpmmState: {
            pool: {
                [outcome: string]: number;
            };
            p: number;
            collectedFees: Fees;
        };
        ordersToCancel: LimitBet[];
    };
    otherBetResults: {
        outcome: string;
        answer: Answer;
        takers: import("./bet.ts").fill[];
        makers: {
            bet: LimitBet;
            amount: number;
            shares: number;
            timestamp: number;
        }[];
        totalFees: Fees;
        cpmmState: {
            pool: {
                [outcome: string]: number;
            };
            p: number;
            collectedFees: Fees;
        };
        ordersToCancel: LimitBet[];
    }[];
};
export declare function calculateCpmmMultiArbitrageSellYes(answers: Answer[], answerToSell: Answer, yesShares: number, limitProb: number | undefined, unfilledBets: LimitBet[], balanceByUserId: {
    [userId: string]: number;
}, collectedFees: Fees): {
    newBetResult: {
        outcome: string;
        takers: import("./bet.ts").fill[];
        makers: {
            bet: LimitBet;
            amount: number;
            shares: number;
            timestamp: number;
        }[];
        totalFees: Fees;
        cpmmState: {
            pool: {
                [outcome: string]: number;
            };
            p: number;
            collectedFees: Fees;
        };
        ordersToCancel: LimitBet[];
    };
    otherBetResults: {
        outcome: string;
        answer: Answer;
        takers: import("./bet.ts").fill[];
        makers: {
            bet: LimitBet;
            amount: number;
            shares: number;
            timestamp: number;
        }[];
        totalFees: Fees;
        cpmmState: {
            pool: {
                [outcome: string]: number;
            };
            p: number;
            collectedFees: Fees;
        };
        ordersToCancel: LimitBet[];
    }[];
};
export declare const calculateCpmmMultiArbitrageSellYesEqually: (initialAnswers: Answer[], userBetsByAnswerIdToSell: {
    [answerId: string]: Bet[];
}, unfilledBets: LimitBet[], balanceByUserId: {
    [userId: string]: number;
}, collectedFees: Fees) => {
    newBetResults: {
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
            collectedFees: Fees;
        };
        answer: Answer;
        totalFees: Fees;
        iteration?: number;
    }[];
    otherBetResults: {
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
            collectedFees: Fees;
        };
        answer: Answer;
        totalFees: Fees;
        iteration?: number;
    }[];
    updatedAnswers: Answer[];
    totalFee: number;
};
export declare const getSellAllRedemptionPreliminaryBets: (answers: Answer[], sharesToSell: number, collectedFees: Fees, now: number) => {
    outcome: "YES";
    takers: {
        matchedBetId: null;
        amount: number;
        shares: number;
        timestamp: number;
        isSale: boolean;
        fees: Fees;
    }[];
    makers: never[];
    totalFees: Fees;
    cpmmState: {
        p: number;
        pool: {
            YES: number;
            NO: number;
        };
        collectedFees: Fees;
    };
    ordersToCancel: never[];
    answer: Answer;
}[];
export declare function floatingArbitrageEqual(a: number, b: number, epsilon?: number): boolean;
