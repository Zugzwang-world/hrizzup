// Written by scripts/types.ts from src/ (pnpm --filter @hrizzup/market-engine types). Do not edit.
import type { MultiContract, resolution } from './contract.ts';
export type Answer = {
    id: string;
    index: number;
    contractId: string;
    userId: string;
    text: string;
    createdTime: number;
    color?: string;
    poolYes: number;
    poolNo: number;
    p: number;
    prob: number;
    totalLiquidity: number;
    subsidyPool: number;
    volume: number;
    isOther?: boolean;
    resolution?: resolution;
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
};
export declare const MAX_ANSWER_LENGTH = 240;
export declare const MAX_ANSWERS = 100;
export declare const MAX_INDEPENDENT_ANSWERS = 200;
export declare const getMaximumAnswers: (shouldAnswersSumToOne: boolean) => 100 | 200;
export declare const OTHER_TOOLTIP_TEXT = "Bet on all answers that aren't listed yet. A bet on Other automatically includes any answer added in the future.";
export type MultiSort = 'prob-desc' | 'prob-mid' | 'prob-asc' | 'old' | 'new' | 'liquidity' | 'alphabetical';
export declare const getDefaultSort: (contract: MultiContract) => "prob-desc" | "prob-mid" | "prob-asc" | "old" | "new" | "liquidity" | "alphabetical";
export declare const answerP: (answer: {
    p?: number;
}) => number;
export declare const sortAnswers: <T extends Answer>(contract: MultiContract, answers: T[], sort?: MultiSort) => T[];
export declare const ANSWERS_TO_HIDE_GRAPH = 4;
export declare function getSortedAnswers(contract: MultiContract, sortedAnswers: Answer[], sort: MultiSort, selectedAnswerIds?: string[]): Answer[];
export declare function getAllResolved(contract: MultiContract, answers: Answer[]): boolean;
export declare function getShouldAnswersSumToOne(contract: MultiContract): boolean;
export declare const MAX_DEFAULT_ANSWERS = 20;
