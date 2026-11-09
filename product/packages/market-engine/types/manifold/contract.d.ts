// Written by scripts/types.ts from src/ (pnpm --filter @hrizzup/market-engine types). Do not edit.
/**
 * Hrizzup's own file, in place of Manifold's `common/src/contract.ts`.
 *
 * Manifold's file describes every kind of Manifold market with all of its site's fields (802
 * lines, and about 100 files through its imports, a rich-text editor among them). The maths
 * reads only a few of those fields. This file keeps Manifold's type names, so the maths
 * imports it unchanged, and gives each type only the fields the maths reads.
 *
 * Hrizzup opens only yes/no markets: `BinaryContract` (mechanism `cpmm-1`, outcome `BINARY`).
 * The other kinds stay here as types because Manifold's maths still branches on them; Hrizzup
 * never opens them.
 */
import type { Answer } from './answer.ts';
import type { Fees } from './fees.ts';
type AnyContractType = (CPMM & Binary) | (CPMM & PseudoNumeric) | (CPMM & Stonk) | CPMMMulti | CPMMNumber | MultiNumeric | MultiDate | (PerpMechanism & Perp);
/** What every market carries that the maths reads. */
export type Contract<T extends AnyContractType = AnyContractType> = {
    id: string;
    visibility: Visibility;
    closeTime?: number;
    isResolved: boolean;
    resolution?: string;
    resolutionProbability?: number;
    collectedFees: Fees;
} & T;
export type CPMMContract = Contract & CPMM;
export type CPMMMultiContract = Contract & CPMMMulti;
export type CPMMNumericContract = Contract & CPMMNumber;
export type MultiNumericContract = Contract & MultiNumeric;
export type MultiDateContract = Contract & MultiDate;
export type MarketContract = CPMMContract | CPMMMultiContract | CPMMNumericContract | MultiNumericContract | MultiDateContract;
export type BinaryContract = Contract & Binary;
export type PseudoNumericContract = Contract & PseudoNumeric;
export type StonkContract = Contract & Stonk;
/** The pool of a yes/no market: Manifold's CPMM, where y^p · n^(1−p) = k. */
export type CPMM = {
    mechanism: 'cpmm-1';
    pool: {
        [outcome: string]: number;
    };
    p: number;
    totalLiquidity: number;
    subsidyPool: number;
    prob: number;
    probChanges: {
        day: number;
        week: number;
        month: number;
    };
};
/** A market with several answers, each its own pool (never opened by Hrizzup). */
export type CPMMMulti = {
    mechanism: 'cpmm-multi-1' | 'cpmm-multi-2';
    outcomeType: 'MULTIPLE_CHOICE';
    shouldAnswersSumToOne: boolean;
    addAnswersMode?: add_answers_mode;
    totalLiquidity: number;
    subsidyPool: number;
    specialLiquidityPerAnswer?: number;
    resolutions?: {
        [answerId: string]: number;
    };
    initialProbabilities?: {
        [answerId: string]: number;
    };
    answers: Answer[];
    sort?: SortType;
};
/** A number market, one answer per bucket (never opened by Hrizzup). */
export type CPMMNumber = {
    mechanism: 'cpmm-multi-1' | 'cpmm-multi-2';
    outcomeType: 'NUMBER';
    shouldAnswersSumToOne: true;
    addAnswersMode: 'DISABLED';
    max: number;
    min: number;
    totalLiquidity: number;
    subsidyPool: number;
    resolutions?: {
        [answerId: string]: number;
    };
    answers: Answer[];
    sort?: SortType;
};
export type add_answers_mode = 'DISABLED' | 'ONLY_CREATOR' | 'ANYONE';
/** A yes/no market: the only kind Hrizzup opens. */
export type Binary = {
    outcomeType: 'BINARY';
    initialProbability: number;
    resolutionProbability?: number;
    resolution?: resolution;
};
/** A number market priced as a probability (never opened by Hrizzup). */
export type PseudoNumeric = {
    outcomeType: 'PSEUDO_NUMERIC';
    min: number;
    max: number;
    isLogScale: boolean;
    initialProbability: number;
    resolutionProbability?: number;
};
/** A range of numbers, one answer per range (never opened by Hrizzup). */
export type MultiNumeric = {
    mechanism: 'cpmm-multi-1' | 'cpmm-multi-2';
    outcomeType: 'MULTI_NUMERIC';
    answers: Answer[];
    shouldAnswersSumToOne: boolean;
    addAnswersMode: 'DISABLED';
    totalLiquidity: number;
    subsidyPool: number;
    resolutions?: {
        [answerId: string]: number;
    };
    resolution?: string;
    sort?: SortType;
};
/** A range of dates, one answer per range (never opened by Hrizzup). */
export type MultiDate = Omit<MultiNumeric, 'outcomeType'> & {
    outcomeType: 'DATE';
};
/**
 * Manifold's perpetual futures, a separate engine (never opened through this maths: Hrizzup's
 * Bitcoin perp, PLAN.md step 3.4, will bring Manifold's perps maths on its own).
 */
export type Perp = {
    outcomeType: 'PERP';
};
export type PerpMechanism = {
    mechanism: 'perp';
};
/** A market that never settles (never opened by Hrizzup). */
export type Stonk = {
    outcomeType: 'STONK';
    initialProbability: number;
};
export type MultiContract = CPMMMultiContract | CPMMNumericContract | MultiNumericContract | MultiDateContract;
export type resolution = 'YES' | 'NO' | 'MKT' | 'CANCEL';
export declare const isMultiCpmm: (contract: Contract) => contract is MultiContract;
export declare function tradingAllowed(contract: Contract, answer: Answer | undefined, now: number): boolean;
export declare const NUMBER_BUCKETS_MAX = 50;
export type Visibility = 'public' | 'unlisted';
export declare const SORTS: readonly [{
    readonly label: "High %";
    readonly value: "prob-desc";
}, {
    readonly label: "Mid %";
    readonly value: "prob-mid";
}, {
    readonly label: "Low %";
    readonly value: "prob-asc";
}, {
    readonly label: "Oldest";
    readonly value: "old";
}, {
    readonly label: "Newest";
    readonly value: "new";
}, {
    readonly label: "Trending";
    readonly value: "liquidity";
}, {
    readonly label: "A-Z";
    readonly value: "alphabetical";
}];
export type SortType = (typeof SORTS)[number]['value'];
export declare const MAX_CPMM_PROB = 0.99;
export declare const MIN_CPMM_PROB = 0.01;
export declare const MAX_STONK_PROB = 0.95;
export declare const MIN_STONK_PROB = 0.2;
export {};
