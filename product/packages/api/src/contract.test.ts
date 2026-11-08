import { standardSchema } from '@hrizzup/agreement';
import { type ContractProcedure, isContractProcedure } from '@orpc/contract';
import { createRouterClient, ORPCError } from '@orpc/server';
import { describe, expect, it } from 'vitest';
import { contract, type Meta } from './contract.ts';
import * as examples from './examples.ts';
import { standIn } from './stand-in.ts';

type AnyProcedure = ContractProcedure<never, never, never, Meta>;
const procedures = Object.entries(contract).filter(([, p]) =>
  isContractProcedure(p),
) as unknown as [string, AnyProcedure][];

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
