import { describe, expect, it } from 'vitest';
import { countFileRead, countViews } from '../counting.ts';
import { runCounts } from './counts.ts';
import { runSkills } from './skills.ts';
import type { JobDeps } from './types.ts';

/**
 * What M3 leaves for later relays to fill (docs/social/build.md, section 8.2): the jobs the door
 * dispatches to answer "no such job" (the door turns it into "No such call") until R11 and R13 build
 * them, and counting does nothing until R11, so the calls that count are written against their final
 * signatures now.
 */

const deps = {} as JobDeps;

describe('the jobs not built yet', () => {
  it('answer null, which the door turns into "No such call"', async () => {
    await expect(runCounts({ posts: [], stories: [], files: [] }, deps)).resolves.toBeNull();
    await expect(runSkills(deps)).resolves.toBeNull();
  });
});

describe('counting, until R11', () => {
  it('counts nothing and fails nothing', async () => {
    await expect(
      countFileRead({ fileId: 'f', agentId: null, address: '198.51.100.7' }),
    ).resolves.toBeUndefined();
    await expect(
      countViews({ requestId: 'r', device: 'd', items: [] } as never, { address: null }),
    ).resolves.toBe(0);
  });
});
