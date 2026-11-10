// Written by scripts/types.ts from src/ (pnpm --filter @hrizzup/market-engine types). Do not edit.
import type { OraclePoint } from './oracle.ts';
import type { PerpDirection, PerpPosition } from './position.ts';
export type PerpOrderRequest = {
    kind: 'trade';
    direction: PerpDirection;
    mana: number;
    leverage: number;
    maxFee: number;
} | {
    kind: 'close';
    direction: PerpDirection;
    fraction: number;
};
export type PerpOrderResult = {
    kind: 'trade';
    position: PerpPosition;
    fee: number;
    isNewUniqueBettor?: boolean;
    feeBps?: number;
    poolShareAfter?: number;
} | {
    kind: 'close';
    payout: number;
    pnl: number;
    fraction: number;
    remainingSize: number;
};
export type PerpOrder = {
    id: string;
    contractId: string;
    status: 'pending' | 'filled' | 'rejected' | 'expired';
    createdTime: number;
    expiresTime: number;
    reservedMana: number;
    request: PerpOrderRequest;
    result: PerpOrderResult | null;
    error: string | null;
};
export declare const MNX_SOURCE_CLOCK_ALLOWANCE_MS = 2000;
export declare const PROVIDER_SOURCE_CLOCK_ALLOWANCE_MS = 2000;
export declare const PROVIDER_STAMPED_FEED_IDS: readonly string[];
export declare const isProviderStampedFeed: (feedId: string) => boolean;
export declare const perpEligibilityCutoff: (feedId: string, point: OraclePoint) => number | null;
export declare const isEligiblePerpTick: (feedId: string, createdTime: number, point: OraclePoint) => boolean;
export declare const PERP_NEXT_PRICE_NOTICE = "Orders fill at the next oracle update, which may differ from the price shown. Orders cannot be cancelled.";
export declare const PERP_PENDING_CLOSE_NOTICE = "Your position remains exposed to price changes, funding and liquidation until the close fills.";
