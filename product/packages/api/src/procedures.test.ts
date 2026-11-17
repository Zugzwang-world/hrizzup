import { oc } from '@orpc/contract';
import { describe, expect, it } from 'vitest';
import { contract, type Meta } from './contract.ts';
import { isPublished, procedures } from './procedures.ts';

/**
 * `isPublished`, the one switch for the OpenAPI file, the docs and the MCP server's tools: by a
 * call's group (the first part of its path) and by its `live` mark. The marks `beta`, `who` and
 * `mcp` change how a published call is shown or used, never whether it's published.
 */

const base = oc.$meta<Meta>({ caching: { kind: 'personal' } });
const withMeta = (meta: Partial<Meta>) =>
  base.meta({ caching: { kind: 'personal' }, ...meta }).route({ method: 'GET', path: '/x' });

describe('isPublished', () => {
  it('is true for an ordinary call, as every call of v1 is', () => {
    expect(isPublished(['markets', 'list'], withMeta({}))).toBe(true);
    expect(isPublished(['health'], withMeta({}))).toBe(true);
  });

  it.each(['admin', 'auth', 'keys', 'owner', 'reader'])(
    'is false for everything under %s',
    (group) => {
      expect(isPublished([group, 'anything'], withMeta({}))).toBe(false);
      expect(isPublished([group, 'deeper', 'still'], withMeta({}))).toBe(false);
      expect(isPublished([group], withMeta({}))).toBe(false);
    },
  );

  it('goes by the first part of the path only, so a similar name is published', () => {
    expect(isPublished(['owners', 'list'], withMeta({}))).toBe(true);
    expect(isPublished(['me', 'keys'], withMeta({}))).toBe(true);
    expect(isPublished(['social', 'admin'], withMeta({}))).toBe(true);
  });

  it('is false for a call not live yet, in any group', () => {
    expect(isPublished(['stories', 'list'], withMeta({ live: false }))).toBe(false);
    expect(isPublished(['stories', 'list'], withMeta({ beta: true, live: false }))).toBe(false);
    expect(isPublished(['admin', 'x'], withMeta({ live: false }))).toBe(false);
  });

  it('stays true for a call in beta, for an agent, or kept out of MCP: those change how it is shown or used', () => {
    expect(isPublished(['stories', 'list'], withMeta({ beta: true }))).toBe(true);
    expect(isPublished(['stories', 'list'], withMeta({ who: 'agent' }))).toBe(true);
    expect(isPublished(['stories', 'list'], withMeta({ who: 'anyone' }))).toBe(true);
    expect(isPublished(['stories', 'list'], withMeta({ mcp: false }))).toBe(true);
  });

  it('keeps the real contract as it was: every call of the console, the sign-in and the keys out, the rest in', () => {
    const calls = procedures(contract);
    expect(calls.length).toBeGreaterThan(12);
    for (const [name, procedure] of calls) {
      const group = name.split('.')[0] ?? '';
      expect(isPublished(name.split('.'), procedure), name).toBe(
        !['admin', 'auth', 'keys', 'owner', 'reader'].includes(group) &&
          procedure['~orpc'].meta.live !== false,
      );
    }
  });
});
