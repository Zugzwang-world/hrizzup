// Written by scripts/types.ts from src/ (pnpm --filter @hrizzup/market-engine types). Do not edit.
import { type Answer } from './answer.ts';
import type { fill, LimitBet } from './bet.ts';
import { type MarketContract } from './contract.ts';
import { type Fees } from './fees.ts';
import type { LiquidityProvision } from './liquidity-provision.ts';
export declare const CPMM_ARBITRAGE_ERROR_PREFIX = "calculateAmountToBuySharesFixedP only works for p = 0.5, got ";
export declare const isCpmmDegenerateStateError: (e: unknown) => e is Error;
export declare const isDrainedPool: (pool: {
    [outcome: string]: number;
}) => boolean;
export declare const isDeepenableProb: (prob: number) => boolean;
export type CpmmState = {
    pool: {
        [outcome: string]: number;
    };
    p: number;
    collectedFees: Fees;
};
export declare function getCpmmProbability(pool: {
    [outcome: string]: number;
}, p: number): number;
export declare function getCpmmProbabilityAfterBetBeforeFees(state: CpmmState, outcome: string, bet: number): number;
export declare function getCpmmOutcomeProbabilityAfterBet(state: CpmmState, outcome: string, bet: number): number;
export declare function calculateCpmmShares(pool: {
    [outcome: string]: number;
}, p: number, betAmount: number, betChoice: string): number;
export declare function getCpmmFees(state: CpmmState, betAmount: number, outcome: string): {
    remainingBet: number;
    totalFees: number;
    fees: {
        creatorFee: number;
        platformFee: number;
        liquidityFee: number;
    };
};
export declare function calculateCpmmSharesAfterFee(state: CpmmState, bet: number, outcome: string): number;
export declare function calculateCpmmPurchase(state: CpmmState, bet: number, outcome: string, freeFees?: boolean): {
    shares: number;
    newPool: {
        YES: number;
        NO: number;
    };
    newP: number;
    fees: Fees | {
        creatorFee: number;
        platformFee: number;
        liquidityFee: number;
    };
};
export declare function calculateCpmmAmountToProb(state: CpmmState, prob: number, outcome: 'YES' | 'NO'): number;
export declare function calculateCpmmAmountToProbIncludingFees(state: CpmmState, prob: number, outcome: 'YES' | 'NO'): number;
export declare function calculateCpmmAmountToBuySharesFixedP(state: CpmmState, shares: number, outcome: 'YES' | 'NO'): number;
export declare const computeFills: (state: CpmmState, outcome: "YES" | "NO", betAmount: number, initialLimitProb: number | undefined, unfilledBets: LimitBet[], balanceByUserId: {
    [userId: string]: number | undefined;
}, limitProbs?: {
    max: number;
    min: number;
}, freeFees?: boolean, now?: number) => {
    takers: fill[];
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
export declare function calculateAmountToBuySharesFixedP(state: CpmmState, shares: number, outcome: 'YES' | 'NO', unfilledBets: LimitBet[], balanceByUserId: {
    [userId: string]: number;
}, freeFees?: boolean): number;
export declare function calculateCpmmMultiSumsToOneSale(answers: Answer[], answerToSell: Answer, shares: number, outcome: 'YES' | 'NO', limitProb: number | undefined, unfilledBets: LimitBet[], balanceByUserId: {
    [userId: string]: number;
}, collectedFees: Fees): {
    saleValue: number;
    buyAmount: number;
    newBetResult: {
        takers: {
            shares: number;
            amount: number;
            isSale: boolean;
            matchedBetId: string | null;
            timestamp: number;
            fees?: Fees;
        }[];
        outcome: "YES" | "NO";
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
        takers: fill[];
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
export declare function calculateAmountToBuyShares(state: CpmmState, shares: number, outcome: 'YES' | 'NO', unfilledBets: LimitBet[], balanceByUserId: {
    [userId: string]: number;
}, now?: number): number;
export declare function calculateCpmmAmountToBuyShares(contract: MarketContract, shares: number, outcome: 'YES' | 'NO', allUnfilledBets: LimitBet[], balanceByUserId: {
    [userId: string]: number;
}, answer?: Answer, now?: number): number;
export declare function calculateCpmmSale(state: CpmmState, shares: number, outcome: 'YES' | 'NO', unfilledBets: LimitBet[], balanceByUserId: {
    [userId: string]: number;
}, now?: number): {
    saleValue: number;
    buyAmount: number;
    cpmmState: {
        pool: {
            [outcome: string]: number;
        };
        p: number;
        collectedFees: Fees;
    };
    fees: Fees;
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
        fees?: Fees;
    }[];
    ordersToCancel: LimitBet[];
};
export declare function getCpmmProbabilityAfterSale(state: CpmmState, shares: number, outcome: 'YES' | 'NO', unfilledBets: LimitBet[], balanceByUserId: {
    [userId: string]: number;
}, now?: number): number;
export declare function getCpmmLiquidity(pool: {
    [outcome: string]: number;
}, p: number): number;
export declare function getMultiCpmmLiquidity(pool: {
    YES: number;
    NO: number;
}): number;
export declare function addCpmmLiquidity(pool: {
    [outcome: string]: number;
}, p: number, amount: number): {
    newPool: {
        YES: number;
        NO: number;
    };
    liquidity: number;
    newP: number;
};
export declare function addCpmmLiquidityFixedP(pool: {
    YES: number;
    NO: number;
}, amount: number): {
    newPool: {
        YES: number;
        NO: number;
    };
    liquidity: number;
    sharesThrownAway: {
        YES: number;
        NO: number;
    };
};
export declare function addCpmmMultiLiquidityToAnswersIndependently(pools: {
    [answerId: string]: {
        YES: number;
        NO: number;
    };
}, amount: number): {
    [x: string]: {
        YES: number;
        NO: number;
    };
};
export declare function addCpmmMultiLiquidityAnswersSumToOne(pools: {
    [answerId: string]: {
        YES: number;
        NO: number;
    };
}, amount: number): {
    [answerId: string]: {
        YES: number;
        NO: number;
    };
};
export declare function cpmmMulti2SumToOneTargetDepths(q: number[], ante: number): number[];
export declare function cpmmMulti2SumToOnePools(q: number[], ante: number): {
    poolYes: number;
    poolNo: number;
    p: number;
    prob: number;
}[];
export declare function pForProbability(pool: {
    YES: number;
    NO: number;
}, q: number): number;
export declare function cpmmMulti2SumToOneFeasible(q: number[]): boolean;
export declare function cpmmMulti2BalancedPools(q: number[], ante: number): {
    poolYes: number;
    poolNo: number;
    p: number;
    prob: number;
}[];
export declare function cpmmMulti2MaxDepthPools(q: number[], ante: number): {
    poolYes: number;
    poolNo: number;
    p: number;
    prob: number;
}[];
export declare function cpmmMulti2SumToOneCreationPools(q: number[], ante: number): {
    poolYes: number;
    poolNo: number;
    p: number;
    prob: number;
}[];
export declare function addCpmmMultiLiquidityAnswersSumToOneV2(poolsByAnswer: {
    [answerId: string]: {
        pool: {
            YES: number;
            NO: number;
        };
        p: number;
    };
}, amount: number): {
    [answerId: string]: {
        pool: {
            YES: number;
            NO: number;
        };
        p: number;
        liquidity: number;
    };
};
export declare const NEW_ANSWER_PROB = 0.02;
export declare const newAnswerOpeningProb: (otherProb: number) => number;
export declare function addAnswerToCpmmMulti2Pools(poolsByAnswer: {
    [answerId: string]: {
        pool: {
            YES: number;
            NO: number;
        };
        p: number;
    };
}, otherAnswerId: string, newAnswerId: string, answerCost: number): {
    [answerId: string]: {
        pool: {
            YES: number;
            NO: number;
        };
        p: number;
    };
} | undefined;
export declare function addCpmmMultiLiquidityToAnswersIndependentlyV2(poolsByAnswer: {
    [answerId: string]: {
        pool: {
            YES: number;
            NO: number;
        };
        p: number;
    };
}, amount: number): {
    [x: string]: {
        pool: {
            YES: number;
            NO: number;
        };
        p: number;
        liquidity: number;
        pendingSubsidy: number;
    };
};
export declare const canDeployCpmmMulti2Liquidity: (poolsByAnswer: {
    [answerId: string]: {
        pool: {
            YES: number;
            NO: number;
        };
        p: number;
    };
}) => boolean;
export declare const getPoolAtProb: (prob: number, amount: number) => {
    YES: number;
    NO: number;
};
export declare const getInitialAnswerPools: (probs: number[], ante: number, shouldAnswersSumToOne: boolean) => {
    YES: number;
    NO: number;
}[];
export declare const MINIMUM_LIQUIDITY = 100;
export declare function removeCpmmLiquidity(pool: {
    [outcome: string]: number;
}, p: number, amount: number): {
    newPool: {
        YES: number;
        NO: number;
    };
    liquidity: number;
    newP: number;
    error: boolean;
};
export declare function maximumRemovableLiquidity(pool: {
    [outcome: string]: number;
}): number;
export declare function getCpmmLiquidityPoolWeights(liquidities: LiquidityProvision[]): {
    [x: string]: number;
};
export declare function getLiquidityWithdrawalShares(liquidities: LiquidityProvision[], amount: number): {
    [x: string]: number;
};
export declare function getLiquidityProvidersNetTotal(liquidities: LiquidityProvision[]): number;
export declare const getLiquidity: (pool: {
    [outcome: string]: number;
}) => number;
export declare function getUserLiquidityShares(userId: string, pool: {
    [outcome: string]: number;
}, liquidities: LiquidityProvision[]): {
    [x: string]: number;
};
