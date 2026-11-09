import { afterEach, describe, expect, it, vi } from 'vitest';
import { MARKETS_TAG, refreshEdge } from './edge-cache.ts';

/**
 * Clearing the edge's copies of a public read (edge-cache.ts), with Vercel's purge stood in for: on
 * a preview, the trading journey proves the list is served from the edge and refreshed after a trade.
 */

afterEach(() => {
  vi.useRealTimers();
});

describe('refreshing the edge', () => {
  it("marks every copy with the list's tag stale", async () => {
    const invalidate = vi.fn().mockResolvedValue(undefined);
    await refreshEdge([MARKETS_TAG], invalidate);
    expect(invalidate).toHaveBeenCalledWith(['markets']);
  });

  it('never fails the change that asked for it', async () => {
    await expect(
      refreshEdge(['markets'], vi.fn().mockRejectedValue(new Error('purge failed'))),
    ).resolves.toBeUndefined();
    await expect(
      refreshEdge(['markets'], () => {
        throw new Error('no purge here');
      }),
    ).resolves.toBeUndefined();
  });

  it('answers within a second and a half even when the edge is slow to take it', async () => {
    vi.useFakeTimers();
    const refreshed = refreshEdge(['markets'], () => new Promise<void>(() => {}));
    await vi.advanceTimersByTimeAsync(1500);
    await expect(refreshed).resolves.toBeUndefined();
  });
});
