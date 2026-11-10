// Written by scripts/types.ts from src/ (pnpm --filter @hrizzup/market-engine types). Do not edit.
export type PerpTradingMode = 'enabled' | 'reduce-only' | 'halted';
export declare const getPerpTradingModeForConfig: (configuredMode: string | undefined, compiledEnabled: boolean) => PerpTradingMode;
