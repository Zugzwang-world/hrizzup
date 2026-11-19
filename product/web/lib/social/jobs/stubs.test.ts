import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetSocialCache } from '../cache.ts';
import { countFileRead, countViews } from '../counting.ts';
import { runSkills } from './skills.ts';
import type { JobDeps } from './types.ts';

/**
 * What M3 left for later relays to fill (docs/social/build.md, section 8.2): the job the door dispatches to
 * answers "no such job" (the door turns it into "No such call") until R13 builds it (`runCounts` left this
 * list when R11 built it, `counts.test.ts`), and counting does nothing where Redis isn't set up, so the calls
 * that count never fail a page or a read (R11's own tests prove the rest: `counting.test.ts`).
 */

const deps = {} as JobDeps;

describe('the jobs not built yet', () => {
  it('answer null, which the door turns into "No such call"', async () => {
    await expect(runSkills(deps)).resolves.toBeNull();
  });
});

describe('counting with no Redis', () => {
  // No Redis whatever the environment this runs in holds (Doppler's `dev` gives this Mac staging's address).
  beforeEach(() => resetSocialCache(null));
  afterEach(() => resetSocialCache());

  it('counts nothing and fails nothing', async () => {
    await expect(
      countFileRead({ fileId: 'f', agentId: null, address: '198.51.100.7' }),
    ).resolves.toBeUndefined();
    await expect(
      countViews({ requestId: 'r', device: 'd', items: [] } as never, { address: null }),
    ).resolves.toBe(0);
  });
});
