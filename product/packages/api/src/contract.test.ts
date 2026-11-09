import { standardSchema } from '@hrizzup/agreement';
import { createRouterClient, ORPCError } from '@orpc/server';
import { describe, expect, it } from 'vitest';
import { consoleMarketWithLog, createMarketInput, settleMarketInput } from './console.ts';
import { contract } from './contract.ts';
import * as examples from './examples.ts';
import { procedures as callsOf } from './procedures.ts';
import { standIn } from './stand-in.ts';

const procedures = callsOf(contract);

describe('the contract', () => {
  it('gives every call a clean address of its own under /api/v1', () => {
    const seen = new Set<string>();
    for (const [name, procedure] of procedures) {
      const { method, path } = procedure['~orpc'].route;
      expect(method, `${name}'s method`).toMatch(/^(GET|POST|PUT|PATCH|DELETE)$/);
      expect(path, `${name}'s address`).toMatch(/^\/[a-z0-9/{}-]+$/);
      const key = `${method} ${path}`;
      expect(seen.has(key), `${key} is used twice`).toBe(false);
      seen.add(key);
    }
  });

  it('says how every answer may be kept: public reads only by GET, with a short edge life and tags', () => {
    for (const [name, procedure] of procedures) {
      const { caching } = procedure['~orpc'].meta;
      if (caching.kind === 'personal') continue;
      expect(procedure['~orpc'].route.method, `${name} is public, so it must be a GET`).toBe('GET');
      expect(caching.edgeSeconds).toBeGreaterThan(0);
      expect(caching.tags.length, `${name}'s cache tags`).toBeGreaterThan(0);
    }
    expect(contract.me['~orpc'].meta.caching.kind).toBe('personal');
    expect(contract.health['~orpc'].meta.caching.kind).toBe('public');
  });
});

describe('the stand-in implementation', () => {
  const api = createRouterClient(standIn());

  it('answers every call with its example, which passes the contract', async () => {
    await expect(api.health()).resolves.toEqual(examples.health);
    await expect(api.me()).resolves.toEqual(examples.me);
  });

  it('refuses any input a call does not take', async () => {
    const refused = api.health({ unexpected: '1' } as never);
    await expect(refused).rejects.toBeInstanceOf(ORPCError);
    await expect(refused).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('answers "not signed in" to who-am-I when nobody is', async () => {
    const signedOut = createRouterClient(standIn({ signedIn: false }));
    await expect(signedOut.me()).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
  });
});

describe('the example content', () => {
  it("is the agreement's own examples, each passing its format's validator", async () => {
    for (const [format, records] of Object.entries(examples.content)) {
      expect(records.length, `${format} has examples`).toBeGreaterThan(0);
      for (const record of records) {
        const result = await standardSchema(format as keyof typeof examples.content)[
          '~standard'
        ].validate(record);
        expect(result.issues, `${format} ${(record as { id: string }).id}`).toBeUndefined();
      }
    }
  });
});

describe("the market console's calls", () => {
  const admin = procedures.filter(([name]) => name.startsWith('admin.'));

  it('are create, open, close and settle, with the two reads the console shows', () => {
    expect(admin.map(([name]) => name).sort()).toEqual([
      'admin.markets.close',
      'admin.markets.create',
      'admin.markets.get',
      'admin.markets.list',
      'admin.markets.open',
      'admin.markets.settle',
    ]);
  });

  it('are personal, never kept, under /admin/, and every write is a POST', () => {
    for (const [name, procedure] of admin) {
      const { route, meta } = procedure['~orpc'];
      expect(meta.caching, name).toEqual({ kind: 'personal' });
      expect(route.path, name).toMatch(/^\/admin\//);
      const reads = name.endsWith('.list') || name.endsWith('.get');
      expect(route.method, name).toBe(reads ? 'GET' : 'POST');
    }
  });
});

describe("a new market's input", () => {
  const hour = 3_600_000;
  const valid = {
    id: '019a6b3c-0001-7000-8000-000000000001',
    question: 'Will test event A happen before the end of the year?',
    categories: ['general', 'ai'],
    rules: 'Yes wins if the test desk records event A.\nOtherwise No wins.',
    source: { name: "Hrizzup's test desk" },
    opensAt: new Date(Date.now() + hour).toISOString(),
    closesAt: new Date(Date.now() + 24 * hour).toISOString(),
  };
  const refused = (change: Record<string, unknown>) =>
    !createMarketInput.safeParse({ ...valid, ...change }).success;

  it('takes a draft that keeps the agreement, starting at 50% with a seed of Ṁ1,000', () => {
    const parsed = createMarketInput.parse(valid);
    expect(parsed).toMatchObject({ probability: '0.5', seed: '1000' });
    expect(
      createMarketInput.safeParse({ ...valid, probability: '0.37', seed: '250.5' }).success,
    ).toBe(true);
  });

  it("refuses what the agreement refuses, by the agreement's own check", () => {
    expect(refused({ question: 'x'.repeat(121) })).toBe(true);
    expect(refused({ question: 'Two\nlines?' })).toBe(true);
    expect(refused({ question: 'Hidden\u200btext?' })).toBe(true);
    expect(refused({ rules: 'x'.repeat(2001) })).toBe(true);
    expect(refused({ source: { name: 'Desk', url: 'http://insecure.example' } })).toBe(true);
    expect(refused({ source: { name: 'Desk', url: '' } })).toBe(true);
    expect(refused({ categories: [] })).toBe(true);
    expect(refused({ categories: ['general', 'ai', 'sports', 'crypto'] })).toBe(true);
    expect(refused({ categories: ['general', 'general'] })).toBe(true);
    expect(refused({ categories: ['weather'] })).toBe(true);
    expect(refused({ id: '019a6b3c-0001-4000-8000-000000000001' })).toBe(true);
    expect(refused({ id: '019A6B3C-0001-7000-8000-000000000001' })).toBe(true);
    expect(refused({ extra: 'field' })).toBe(true);
  });

  it('refuses a closing time in the past, and an opening time at or after it', () => {
    expect(refused({ closesAt: new Date(Date.now() - hour).toISOString() })).toBe(true);
    expect(refused({ opensAt: valid.closesAt })).toBe(true);
  });

  it('refuses a starting probability outside 1% to 99%, and a seed of nothing or too much', () => {
    for (const probability of ['0.995', '0.005', '1', '0', '-0.5', '0.123456789']) {
      expect(refused({ probability }), probability).toBe(true);
    }
    for (const seed of ['0', '-5', '1000000.5', '2000000', '1.0000001']) {
      expect(refused({ seed }), seed).toBe(true);
    }
  });
});

describe("a settlement's input", () => {
  const id = '019a6b3c-0001-7000-8000-000000000001';
  const ok = (input: Record<string, unknown>) =>
    settleMarketInput.safeParse({ id, evidence: 'What the test desk recorded.', ...input }).success;

  it('takes Yes, No, a set probability with its probability, or a cancel with its reason', () => {
    expect(ok({ outcome: 'yes' })).toBe(true);
    expect(ok({ outcome: 'no' })).toBe(true);
    expect(ok({ outcome: 'probability', probability: '0.7' })).toBe(true);
    expect(ok({ outcome: 'cancel', reason: 'The test desk recorded nothing.' })).toBe(true);
  });

  it("refuses a probability or a reason where it doesn't belong, or missing where it does", () => {
    expect(ok({ outcome: 'probability' })).toBe(false);
    expect(ok({ outcome: 'yes', probability: '0.7' })).toBe(false);
    expect(ok({ outcome: 'probability', probability: '0.995' })).toBe(false);
    expect(ok({ outcome: 'cancel' })).toBe(false);
    expect(ok({ outcome: 'no', reason: 'A reason.' })).toBe(false);
    expect(ok({ outcome: 'maybe' })).toBe(false);
  });

  it('needs its evidence', () => {
    expect(settleMarketInput.safeParse({ id, outcome: 'yes' }).success).toBe(false);
    expect(ok({ outcome: 'yes', evidence: '' })).toBe(false);
  });
});

describe("the stand-in's market console", () => {
  it("answers an admin with the example market, built from the agreement's own example", async () => {
    const api = createRouterClient(standIn());
    const page = await api.admin.markets.list();
    expect(page).toEqual({ markets: [examples.consoleMarket], next: null });
    const market = await api.admin.markets.get({ id: examples.consoleMarketWithLog.id });
    expect(consoleMarketWithLog.parse(market)).toEqual(examples.consoleMarketWithLog);
    const [first] = examples.content['market/1'];
    expect(market).toMatchObject({ id: first?.id, question: first?.question, state: first?.state });
  });

  it("answers anyone but an admin, signed in or not, as an address the API doesn't have", async () => {
    for (const options of [{ admin: false }, { signedIn: false }]) {
      const api = createRouterClient(standIn(options));
      await expect(api.admin.markets.list()).rejects.toMatchObject({
        code: 'NOT_FOUND',
        message: 'No such call',
      });
      await expect(
        api.admin.markets.get({ id: examples.consoleMarketWithLog.id }),
      ).rejects.toBeInstanceOf(ORPCError);
    }
  });
});
