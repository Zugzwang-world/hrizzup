import { contract, isSocialCall, type Meta, procedures, social as socialApi } from '@hrizzup/api';
import { health, social as socialExamples } from '@hrizzup/api/examples';
import { createRouterClient, isProcedure, os, Procedure } from '@orpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './base.ts';
import { isReachable, reachable } from './reachable.ts';
import { router } from './router.ts';

/**
 * Which calls of the typed API can be reached (docs/social/build.md, D9 and D14): the live ones, and
 * where social is off (production, until launch) none of social's. The route serves a router with
 * the others left out (so an address for one is unmatched, and answers as any address the API doesn't
 * have, which `app/api/v1/[[...rest]]/social.test.ts` holds to the byte), and the website's own
 * server code, which calls in process, is turned away by the same rule (base.ts).
 */

const call = (meta: Partial<Meta> = {}) => ({ '~orpc': { meta } });

describe('isReachable', () => {
  it('is true for a live call, anywhere', () => {
    expect(isReachable(['markets', 'list'], call(), true)).toBe(true);
    expect(isReachable(['markets', 'list'], call(), false)).toBe(true);
    expect(isReachable(['social', 'board'], call({ beta: true }), true)).toBe(true);
  });

  it('is false for a call not live yet, anywhere, whoever it is for', () => {
    for (const path of [
      ['markets', 'list'],
      ['social', 'board'],
      ['admin', 'social', 'x'],
    ]) {
      expect(isReachable(path, call({ live: false }), true), path.join('.')).toBe(false);
      expect(isReachable(path, call({ live: false }), false), path.join('.')).toBe(false);
    }
  });

  it('is false for every social call where social is off, even a live one, and true for the others', () => {
    for (const path of [
      ['social', 'board'],
      ['owner', 'agent'],
      ['reader', 'get'],
      ['admin', 'social', 'invites', 'create'],
    ]) {
      expect(isReachable(path, call(), false), path.join('.')).toBe(false);
      expect(isReachable(path, call(), true), path.join('.')).toBe(true);
    }
    for (const path of [
      ['admin', 'markets', 'list'],
      ['markets', 'list'],
      ['me'],
      ['keys', 'list'],
    ]) {
      expect(isReachable(path, call(), false), path.join('.')).toBe(true);
    }
  });
});

describe('the router the route serves', () => {
  const all = (tree: object) => procedures(tree).map(([name]) => name);
  const social = all(contract).filter((name) => isSocialCall(name.split('.')));

  it('has a handler for every social call, so the pruning is what hides them', () => {
    expect(social.length).toBe(74);
    expect(all(router)).toEqual(expect.arrayContaining(social));
  });

  it('leaves out every call not live yet, and keeps every other', () => {
    const served = all(reachable(router, (path, one) => isReachable(path, one, true)));
    const live = procedures(contract)
      .filter(([, procedure]) => procedure['~orpc'].meta.live !== false)
      .map(([name]) => name);
    expect(served.sort()).toEqual(live.sort());
    // Of social's calls, only the live ones are served: M3's three console calls, and each relay's own once built.
    const servedSocial = served.filter((name) => isSocialCall(name.split('.')));
    expect(servedSocial).toEqual(social.filter((name) => live.includes(name)).sort());
    expect(servedSocial).toEqual(
      expect.arrayContaining([
        'admin.social.invites.create',
        'admin.social.stories.save',
        'admin.social.updates.save',
      ]),
    );
    expect(served).toEqual(
      expect.arrayContaining(['health', 'markets.list', 'admin.markets.list']),
    );
  });

  it('leaves out every social call, live or not, where social is off', () => {
    const served = all(reachable(router, (path, one) => isReachable(path, one, false)));
    expect(served.some((name) => isSocialCall(name.split('.')))).toBe(false);
    expect(served).toEqual(expect.arrayContaining(['health', 'markets.list', 'admin.perps.list']));
  });

  it('is a copy of fresh groups, so the original keeps every call and carries nothing over', () => {
    const copy = reachable(router, () => true) as Record<string, unknown>;
    expect(copy).not.toBe(router);
    expect(copy.markets).not.toBe((router as Record<string, unknown>).markets);
    expect(all(copy)).toEqual(all(router));
    // The copy holds the very procedures, so a call that is served is the real one.
    const served = (copy.markets as Record<string, unknown>).list;
    expect(isProcedure(served)).toBe(true);
    expect(served).toBe((router.markets as Record<string, unknown>).list);
    expect(all(router).length).toBe(procedures(contract).length);
  });

  it('drops a group left with no call, and prunes by any rule it is given', () => {
    const live = os.meta({ caching: { kind: 'personal' } }).handler(() => 'live');
    const later = os.meta({ caching: { kind: 'personal' }, live: false }).handler(() => 'later');
    const small = { stories: { later }, markets: { list: live, deeper: { later } } };
    const served = reachable(small, (_path, one) => one['~orpc'].meta.live !== false) as {
      stories?: unknown;
      markets: { list: unknown; deeper?: unknown };
    };
    expect(served.stories).toBeUndefined();
    expect(served.markets.deeper).toBeUndefined();
    expect(served.markets.list).toBe(live);
  });
});

describe('a social call that is live, once one is built', () => {
  // Made-up live calls, whatever the real ones are (M3's three console calls, then each relay's own): they show what a relay's first one meets.
  const live = os.meta({ caching: { kind: 'personal' }, beta: true }).handler(() => 'live');
  const later = os.meta({ caching: { kind: 'personal' }, live: false }).handler(() => 'later');
  const small = {
    markets: { list: live },
    social: { board: live, stories: { get: later } },
    owner: { agent: live },
    reader: { get: later },
    admin: { markets: { list: live }, social: { invites: { create: live, list: later } } },
  };
  const served = (socialIsOn: boolean) =>
    procedures(reachable(small, (path, one) => isReachable(path, one, socialIsOn)))
      .map(([name]) => name)
      .sort();

  it('is served where social is on, and its neighbours that are not live are not', () => {
    expect(served(true)).toEqual([
      'admin.markets.list',
      'admin.social.invites.create',
      'markets.list',
      'owner.agent',
      'social.board',
    ]);
  });

  it('is not served where social is off, in any of its four groups, and the market API is untouched', () => {
    expect(served(false)).toEqual(['admin.markets.list', 'markets.list']);
  });
});

describe('a live social call, called in process', () => {
  // A made-up live public read (the contract's own `social.lists`, its not-live mark taken off with
  // live()) shows base.ts's social-off choice by itself, whichever calls are live in the contract. It is made from base.ts's implementer,
  // so its middleware is the one the website's own server code meets.
  const built = api.social.lists.handler(() => socialExamples.board.lists);
  const liveSocial = new Procedure({
    ...built['~orpc'],
    meta: { ...built['~orpc'].meta, ...socialApi.live(socialApi.anyoneMeta) },
  });
  const liveMarket = api.health.handler(() => health);
  const client = createRouterClient(
    { health: liveMarket, social: { lists: liveSocial } },
    { context: { headers: new Headers() } },
  );

  beforeEach(() => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('VERCEL_TARGET_ENV', 'staging');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('is called where social is on', async () => {
    expect(liveSocial['~orpc'].meta.live).toBeUndefined();
    await expect(client.social.lists()).resolves.toEqual(socialExamples.board.lists);
  });

  it('is told “No such call” where social is off, and a live call that is not social’s is not', async () => {
    vi.stubEnv('VERCEL_TARGET_ENV', 'production');
    await expect(client.social.lists()).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
      message: 'No such call',
    });
    await expect(client.health()).resolves.toEqual(health);
  });
});

describe('the website’s own server code, which calls in process', () => {
  const client = createRouterClient(router, { context: { headers: new Headers() } });
  type Client = (input?: unknown) => Promise<unknown>;
  const clientFor = (name: string) =>
    name
      .split('.')
      .reduce<unknown>((at, part) => (at as Record<string, unknown>)[part], client) as Client;

  it('is told “No such call” by every social call not live yet, and every console call, before any input is read or any handler runs', async () => {
    const social = procedures(contract).filter(([name]) => isSocialCall(name.split('.')));
    expect(social.length).toBe(74);
    // A call not live yet answers so whoever asks. A console call does whatever its mark, since this
    // client has no admin session. The live public reads and agent calls are tried in
    // `app/api/v1/[[...rest]]/social.test.ts`.
    const turnedAway = social.filter(
      ([name, procedure]) => procedure['~orpc'].meta.live === false || name.startsWith('admin.'),
    );
    expect(turnedAway.length).toBeGreaterThan(0);
    // The console's three live calls are among them, so the console rule is tried too.
    expect(turnedAway.map(([name]) => name)).toEqual(
      expect.arrayContaining([
        'admin.social.invites.create',
        'admin.social.stories.save',
        'admin.social.updates.save',
      ]),
    );
    for (const [name] of turnedAway) {
      // An input no call would take: the answer is the same, so nothing was read.
      for (const input of [undefined, {}, { unknown: 1 }, 'not an object']) {
        await expect(clientFor(name)(input), name).rejects.toMatchObject({
          code: 'NOT_FOUND',
          status: 404,
          message: 'No such call',
        });
      }
    }
  });

  it('still reaches a live call', async () => {
    await expect(clientFor('me')()).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
