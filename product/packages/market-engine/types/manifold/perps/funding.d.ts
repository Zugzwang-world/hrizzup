// Written by scripts/types.ts from src/ (pnpm --filter @hrizzup/market-engine types). Do not edit.
/**
 * The funding rate a contract is currently accruing, for display.
 *
 * Read-side counterpart to the engine's rate: both feed open interest into
 * `computeFundingRate`, so the number a trader sees matches the one that
 * will be applied. Callers must NOT reach for `computeFundingRate` with the
 * pools — that is the bug this exists to prevent.
 *
 * Computed live rather than read from `contract.fundingRate`, which the
 * scheduler only refreshes at each funding event: a trader who just moved
 * the imbalance would otherwise see the previous period's rate, often with
 * the opposite sign, until the next tick.
 *
 * Open interest is maintained on the contract by every engine transition
 * that can change position size. Absent (a contract not yet touched since
 * the field was added) reads as zero, which yields a zero rate — funding is
 * never displayed in a direction we cannot substantiate.
 */
export declare const getPerpFundingRate: (contract: {
    openInterestLong?: number;
    openInterestShort?: number;
    fundingSensitivity: number;
    maxFundingRate: number;
}) => number;
/**
 * Default funding period. Contracts created before per-contract periods
 * existed carry no `fundingPeriodMs` and fall back to hourly — the cadence
 * they were trading under all along.
 */
export declare const FUNDING_PERIOD_MS: number;
/**
 * A contract's funding period. Derived from the oracle feed's update cadence
 * at create time (`max(1h, feed.updatePeriodMs)`) and frozen on the contract,
 * so a later change to the feed registry can't rewrite the economics of
 * positions people already hold.
 */
export declare const getFundingPeriodMs: (contract: {
    fundingPeriodMs?: number;
}) => number;
/**
 * Should a funding event fire now?
 *
 * 1. The first event requires a complete period from market creation. Later
 *    events allow one minute of scheduler jitter: cron fires at :00 sharp,
 *    so a run often starts a few hundred ms EARLIER in the second than the
 *    previous event's commit stamp. A full-period comparison silently skips
 *    those later events (observed live: 16:00:01.104 event, 17:00:00.822 run,
 *    elapsed 3,599,780ms). The first event has no prior cron commit jitter,
 *    and charging a full period minutes after creation would be unfair.
 *
 * 2. For periods LONGER than the scheduler's hourly funding cadence only:
 *    the oracle produced a new price since the last funding event. The
 *    anchor exists to kill the PREDICTABLE dodge — a free-running 24h timer
 *    drifts off the daily tick until funding fires at a time the price
 *    provably won't move, and sitting flat across it costs nothing. That
 *    dodge only exists when funding can fire more often than the feed
 *    produces values, which the period derivation (max(1h, cadence)) makes
 *    impossible for hourly contracts: every hourly period contains expected
 *    movement, so any skip there would be timestamp minutiae (a NESO block
 *    stamped 17:00:00.000 vs an event stamped 17:00:00.822), not dodge
 *    prevention — unpredictable timing noise is already friction enough.
 *    For slow periods the comparison is strict with no slack: the normal
 *    case has hours of margin, and a value stamped seconds before the last
 *    funding with nothing since really is a feed that produced nothing all
 *    period — no movement, no carry. update-perps' staleness alerting
 *    covers detection.
 *
 * Callers pass their best view of the latest oracle timestamp: the engine
 * passes the contract's applied `oraclePriceTime`; the scheduler prefilter
 * passes the feed's latest row. The prefilter runs after runOracleUpdate,
 * so prefilter-pass implies the engine sees the same or newer.
 */
export declare const shouldApplyFunding: (args: {
    now: number;
    /** ts of the last funding event; undefined/0 = never funded. */
    lastFundingTime: number | undefined;
    /** Market creation time; the first full holding period starts here. */
    fundingStartTime: number;
    /** ts of the newest oracle price known to the caller. */
    latestOracleTime: number | undefined;
    fundingPeriodMs: number;
}) => boolean;
/**
 * Short unit label for funding copy: "hr" for hourly, "day" for daily,
 * "4h"-style otherwise. Pair with fundingPeriodNoun for prose.
 */
export declare const fundingPeriodUnit: (periodMs: number) => string;
/** Prose noun: "hour", "day", or "4 hours". */
export declare const fundingPeriodNoun: (periodMs: number) => string;
