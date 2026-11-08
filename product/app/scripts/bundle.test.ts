import { describe, expect, it } from 'vitest';
import { compare, MAX_UNEXPLAINED_GROWTH_PERCENT, markdown } from './bundle.ts';

const limit = { androidKB: 2700, reason: 'the empty app' };
const KB = 1024;

describe("the app's code-size check", () => {
  it('passes a bundle under its limit that grew a little', () => {
    const result = compare({ androidBytes: 2500 * KB }, { androidBytes: 2450 * KB }, limit, limit);
    expect(result.passes).toBe(true);
    expect(result.row).toBe(
      '| App, Android code bundle | ✅ 2500.0 KB / 2700 KB | +2.0% (main: 2450.0 KB) |',
    );
  });

  it('fails a bundle over its limit', () => {
    const result = compare({ androidBytes: 2701 * KB }, { androidBytes: 2690 * KB }, limit, limit);
    expect(result.passes).toBe(false);
    expect(result.problems.join()).toMatch(/over its limit of 2700 KB/);
  });

  it('fails a jump of more than 5% in one pull request that leaves the limit as it was', () => {
    const base = { androidBytes: 2000 * KB };
    const jump = {
      androidBytes: Math.ceil(2000 * KB * (1 + MAX_UNEXPLAINED_GROWTH_PERCENT / 100)) + 1,
    };
    const result = compare(jump, base, limit, limit);
    expect(result.passes).toBe(false);
    expect(result.problems.join()).toMatch(/without raising the limit/);
  });

  it('passes the same jump when the pull request raises the limit (its reason explains it)', () => {
    const raised = { androidKB: 2900, reason: 'the typed API client and TanStack Query' };
    const result = compare({ androidBytes: 2600 * KB }, { androidBytes: 2400 * KB }, raised, limit);
    expect(result.passes).toBe(true);
  });

  it("still checks the limit when main's size isn't known", () => {
    const result = compare({ androidBytes: 2500 * KB }, null, limit, null);
    expect(result.passes).toBe(true);
    expect(result.row).toContain('main not measured');
  });

  it('shows shrinking, and lists every problem under the table', () => {
    expect(
      compare({ androidBytes: 900 * KB }, { androidBytes: 1000 * KB }, limit, limit).row,
    ).toContain('-10.0% (main: 1000.0 KB)');
    const table = markdown(compare({ androidBytes: 2800 * KB }, null, limit, null));
    expect(table).toContain('- ❌ the bundle (2800.0 KB) is over its limit of 2700 KB.');
  });
});
