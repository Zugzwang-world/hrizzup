// Written by scripts/types.ts from src/ (pnpm --filter @hrizzup/market-engine types). Do not edit.
export declare const BINARY_SEARCH_NAN_ERROR = "binarySearch: comparator returned NaN";
export declare function binarySearch(min: number, max: number, comparator: (x: number) => number, maxIterations?: number): number;
export declare function findRoot(min: number, max: number, comparator: (x: number) => number, maxIterations?: number): number;
