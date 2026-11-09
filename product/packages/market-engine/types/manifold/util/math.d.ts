// Written by scripts/types.ts from src/ (pnpm --filter @hrizzup/market-engine types). Do not edit.
export declare const logInterpolation: (min: number, max: number, value: number) => number;
export declare const logit: (x: number) => number;
export declare function median(xs: number[]): number;
export declare function average(xs: number[]): number;
export declare function sumOfSquaredError(xs: number[]): number;
export declare const EPSILON = 1e-8;
export declare function floatingEqual(a: number, b: number, epsilon?: number): boolean;
export declare function floatingGreater(a: number, b: number, epsilon?: number): boolean;
export declare function floatingGreaterEqual(a: number, b: number, epsilon?: number): boolean;
export declare function floatingLesserEqual(a: number, b: number, epsilon?: number): boolean;
