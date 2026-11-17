import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { contract } from './contract.ts';
import { commonErrors, pageFields, pageInput, pageLimit } from './paging.ts';
import { isSocialCall, procedures } from './procedures.ts';
import { addressFields, filterFields } from './social/common.ts';

/**
 * The public API's ground rules (PLAN.md step 3.5a), held to every call in the contract, so a new
 * call can't skip them: the common errors; one way to page through every list; nothing named
 * `after` any more; and the errors each kind of call can answer. Social's twenty lists are held
 * to the same page, beside the address and filter fields they name (docs/social/build.md, D5).
 */

const calls = procedures(contract);

type Schema = z.ZodType & { def?: { innerType?: Schema; shape?: Record<string, unknown> } };

/** An object schema's fields, through `.optional()`, or undefined for anything else. */
function fields(schema: unknown): Record<string, unknown> | undefined {
  let at = schema as Schema | undefined;
  while (at?.def?.innerType) at = at.def.innerType;
  return (at as { shape?: Record<string, unknown> } | undefined)?.shape;
}

const isList = (procedure: (typeof calls)[number][1]) =>
  fields(procedure['~orpc'].outputSchema)?.next !== undefined;

/** Every call whose answer pages, and the two sets of them: v1's (the market API's) and social's. */
const everyList = calls.filter(([, procedure]) => isList(procedure));
const social = everyList.filter(([name]) => isSocialCall(name.split('.')));
const v1 = everyList.filter(([name]) => !isSocialCall(name.split('.')));

describe('the ground rules, for every call', () => {
  it('every call may answer the common errors: a refused input (400, with its issues) and try again (503)', () => {
    for (const [name, procedure] of calls) {
      const errors = procedure['~orpc'].errorMap as Record<string, { status?: number }>;
      expect(errors.BAD_REQUEST, name).toEqual(commonErrors.BAD_REQUEST);
      expect(errors.SERVICE_UNAVAILABLE?.status, name).toBe(503);
    }
  });

  it('every list pages one way: cursor and limit in, next out; nothing is called `after`', () => {
    // The v1 lists are exactly what they were, each held to what it was held to: social's lists are
    // held to their own rule below, and the two sets together are every list.
    const lists = v1;
    expect(lists.map(([name]) => name).sort()).toEqual(
      [
        'admin.markets.list',
        'admin.perps.list',
        'markets.list',
        'markets.trades',
        'portfolio.orders',
        'portfolio.perps',
        'portfolio.positions',
        'portfolio.trades',
      ].sort(),
    );
    // A list takes the page's two fields and nothing else; a list of one thing's own (a market's
    // trades) takes them beside that thing's address, the very same fields.
    for (const [name, procedure] of lists) {
      const input = procedure['~orpc'].inputSchema;
      if (input === pageInput) continue;
      const own = fields(input) ?? {};
      expect(Object.keys(own).sort(), name).toEqual(['cursor', 'id', 'limit']);
      expect(own.cursor, name).toBe(pageFields.cursor);
      expect(own.limit, name).toBe(pageFields.limit);
    }
    for (const [name, procedure] of calls) {
      expect(fields(procedure['~orpc'].inputSchema)?.after, name).toBeUndefined();
    }
  });

  it("holds social's twenty lists to the very same page, beside the address and filter fields they name", () => {
    expect(social.map(([name]) => name).sort()).toEqual(
      [
        'admin.social.agents.list',
        'admin.social.invites.list',
        'admin.social.stories.list',
        'owner.chat.list',
        'owner.tasks.list',
        'reader.chat.list',
        'reader.forYou',
        'social.agents.fileVersions',
        'social.agents.list',
        'social.agents.posts',
        'social.agents.timeline',
        'social.board',
        'social.me.chat',
        'social.me.inbox',
        'social.me.pins',
        'social.me.stats',
        'social.posts.replies',
        'social.skills.list',
        'social.stories.posts',
        'social.stories.updates',
      ].sort(),
    );
    // What a list may take besides its page: an address, or a filter, each the very schema object
    // that `social/common.ts` exports, so a list can't have a field of its own that no other has.
    const named: Record<string, unknown> = { ...addressFields, ...filterFields };
    expect(Object.keys(named).sort()).toEqual([
      'category',
      'handle',
      'id',
      'name',
      'parent',
      'place',
      'sort',
    ]);
    for (const [name, procedure] of social) {
      const input = procedure['~orpc'].inputSchema;
      if (input === pageInput) continue;
      const own = fields(input) ?? {};
      expect(own.cursor, name).toBe(pageFields.cursor);
      expect(own.limit, name).toBe(pageFields.limit);
      for (const [field, schema] of Object.entries(own)) {
        if (field === 'cursor' || field === 'limit') continue;
        expect(named[field], `${name}'s ${field} is a named field`).toBeDefined();
        expect(schema, `${name}'s ${field} is the very schema in common.ts`).toBe(named[field]);
      }
    }
  });

  it("every list is v1's or social's, and no call is both", () => {
    expect(v1.length).toBe(8);
    expect(social.length).toBe(20);
    expect(everyList.length).toBe(v1.length + social.length);
    expect(new Set([...v1, ...social].map(([name]) => name)).size).toBe(everyList.length);
  });

  it('a page holds 1 to 100, 50 when not asked, and takes its limit as text from an address', () => {
    expect(pageInput.parse(undefined)).toBeUndefined();
    expect(pageInput.parse({ limit: '20' })).toEqual({ limit: 20 });
    for (const bad of ['0', '101', '2.5', 'many', '']) {
      expect(pageLimit.safeParse(bad).success, bad).toBe(false);
    }
    expect(pageInput.safeParse({ after: 'x' }).success).toBe(false);
  });

  it('every personal call may answer "not signed in", and every trading call a read-only key and its limit', () => {
    for (const [name, procedure] of calls) {
      if (name.startsWith('admin.') || name.startsWith('auth.')) continue;
      const errors = procedure['~orpc'].errorMap as Record<string, { status?: number }>;
      if (procedure['~orpc'].meta.caching.kind === 'personal') {
        expect(errors.UNAUTHORIZED?.status, name).toBe(401);
        expect(errors.TOO_MANY_REQUESTS?.status, name).toBe(429);
      }
    }
    for (const name of ['markets.trade', 'markets.cancelOrder', 'perps.open', 'perps.close']) {
      const [, procedure] = calls.find(([call]) => call === name) ?? [];
      const errors = procedure?.['~orpc'].errorMap as unknown as Record<
        string,
        { status?: number }
      >;
      expect(errors.FORBIDDEN?.status, name).toBe(403);
      expect(errors.REFUSED?.status, name).toBe(422);
    }
  });
});
