// Written by scripts/types.ts from src/ (pnpm --filter @hrizzup/market-engine types). Do not edit.
import type { add_answers_mode, Contract, Visibility } from './contract.ts';
export declare function getNewContract(props: {
    id: string;
    closeTime?: number;
    visibility: Visibility;
    creator: {
        id: string;
    };
    outcomeType: 'BINARY' | 'MULTIPLE_CHOICE';
    initialProb: number;
    ante: number;
    answers: string[];
    addAnswersMode?: add_answers_mode | undefined;
    shouldAnswersSumToOne?: boolean | undefined;
    answerShortTexts?: string[];
    answerImageUrls?: string[];
    answerProbs?: number[];
    answerColors?: string[];
    cpmmMulti2Enabled?: boolean;
}): Contract;
export declare const VERSUS_COLORS: string[];
export declare const MIN_ANSWER_PROB: number;
export declare const MAX_ANSWER_PROB: number;
export declare const opensAsCpmmMulti2: (props: {
    cpmmMulti2Enabled?: boolean;
}) => boolean;
