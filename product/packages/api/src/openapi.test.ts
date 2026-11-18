import { readFileSync } from 'node:fs';
import { oc } from '@orpc/contract';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { contract, type Meta } from './contract.ts';
import { betaOperations, isPublished, openapiPath, renderOpenAPI } from './openapi.ts';
import { procedures } from './procedures.ts';

/**
 * The public API's OpenAPI file (PLAN.md step 3.5a): made from the contract, kept in the
 * repository, and describing every public call and nothing else. Quick checks compare it with
 * main's for breaking changes (.github/scripts/api_breaking.py).
 */

type Operation = {
  operationId: string;
  tags?: string[];
  security?: unknown[];
  responses: Record<string, unknown>;
  'x-stability-level'?: string;
};

const file = () =>
  JSON.parse(readFileSync(openapiPath, 'utf8')) as {
    openapi: string;
    servers: { url: string }[];
    paths: Record<string, Record<string, Operation>>;
    components: { schemas: Record<string, unknown> };
  };

const operations = () =>
  Object.values(file().paths).flatMap((item) => Object.values(item)) as Operation[];

describe('the OpenAPI file', () => {
  it('is current (if not, run `pnpm --filter @hrizzup/api openapi`)', async () => {
    expect(readFileSync(openapiPath, 'utf8')).toBe(await renderOpenAPI());
  });

  it('describes every public call, and never the console, the app’s sign-in or the keys’ own calls', () => {
    const published = procedures(contract)
      .filter(([name, procedure]) => isPublished(name.split('.'), procedure))
      .map(([name]) => name)
      .sort();
    expect(published.length).toBeGreaterThanOrEqual(12);
    expect(
      operations()
        .map((operation) => operation.operationId)
        .sort(),
    ).toEqual(published);
    for (const path of Object.keys(file().paths)) {
      expect(path).not.toMatch(/^\/(admin|auth)\b|^\/me\/keys/);
    }
  });

  it('is OpenAPI 3.1, served from staging, the demo', () => {
    expect(file().openapi).toMatch(/^3\.1\./);
    expect(file().servers).toEqual([
      expect.objectContaining({ url: 'https://staging.hrizzup.com/api/v1' }),
    ]);
  });

  it('asks for the key on every personal call and on no public read', () => {
    for (const operation of operations()) {
      const personal = operation.tags?.includes('personal') ?? false;
      expect(operation.security, operation.operationId).toEqual(
        personal ? [{ apiKey: [] }] : undefined,
      );
    }
  });

  it("lists each call's success and errors, and describes a market as the agreement does", () => {
    // Every call answers 200 unless its route says another success status (a registration answers 201).
    const success = new Map(
      procedures(contract).map(([name, procedure]) => [
        name,
        String(procedure['~orpc'].route.successStatus ?? 200),
      ]),
    );
    for (const operation of operations()) {
      expect(Object.keys(operation.responses), operation.operationId).toEqual(
        expect.arrayContaining([success.get(operation.operationId) ?? '200', '400', '503']),
      );
    }
    const market = file().components.schemas.Market as { required: string[] };
    expect(market.required).toContain('question');
    expect(JSON.stringify(file())).not.toContain('"not":{}');
  });
});

describe('beta calls and calls not live yet', () => {
  /** The operation IDs carrying the beta mark. */
  const marked = (operationList: Operation[]) =>
    operationList
      .filter((operation) => operation['x-stability-level'] === 'beta')
      .map((operation) => operation.operationId)
      .sort();

  it('marks `x-stability-level: beta` on exactly the published calls in beta (none yet, then the social calls)', () => {
    const expected = procedures(contract)
      .filter(([name, procedure]) => isPublished(name.split('.'), procedure))
      .filter(([, procedure]) => procedure['~orpc'].meta.beta === true)
      .map(([name]) => name)
      .sort();
    expect(marked(operations())).toEqual(expected);
    expect([...betaOperations(contract)].sort()).toEqual(expected);
    // No call has any other stability level.
    for (const operation of operations()) {
      expect(operation['x-stability-level'] ?? 'beta', operation.operationId).toBe('beta');
    }
  });

  it('has no call that is not live yet', () => {
    const notLive = procedures(contract)
      .filter(([, procedure]) => procedure['~orpc'].meta.live === false)
      .map(([name]) => name);
    const ids = operations().map((operation) => operation.operationId);
    for (const name of notLive) expect(ids, name).not.toContain(name);
  });

  // A small contract of every kind shows the rendering, whichever social calls are live in the real one.
  const call = oc.$meta<Meta>({ caching: { kind: 'personal' } });
  const answer = z.object({ ok: z.boolean() });
  const make = (path: `/${string}`, meta: Partial<Meta> = {}) =>
    call
      .meta({ caching: { kind: 'personal' }, ...meta })
      .route({ method: 'GET', path, summary: `A call at ${path}` })
      .output(answer);
  const fixture = {
    markets: { list: make('/markets') },
    stories: {
      list: make('/stories', { beta: true }),
      later: make('/stories/later', { beta: true, live: false }),
      toolless: make('/stories/toolless', { beta: true, mcp: false }),
      agentOnly: make('/stories/agent', { beta: true, who: 'agent' }),
    },
    owner: { agent: make('/owner/agent', { beta: true }) },
    reader: { chat: make('/reader/chat', { beta: true }) },
    admin: { social: { save: make('/admin/social/save', { beta: true }) } },
    unfinished: { call: make('/unfinished', { live: false }) },
  };

  it('writes the mark, by our own code, on each published call in beta and no other', async () => {
    const built = JSON.parse(await renderOpenAPI(fixture)) as {
      paths: Record<string, Record<string, Operation>>;
    };
    const found = Object.values(built.paths).flatMap((item) => Object.values(item));
    expect(found.map((operation) => operation.operationId).sort()).toEqual([
      'markets.list',
      'stories.agentOnly',
      'stories.list',
      'stories.toolless',
    ]);
    // A call kept out of MCP stays in the file; the mark is on every beta call, never on v1's.
    expect(marked(found)).toEqual(['stories.agentOnly', 'stories.list', 'stories.toolless']);
    expect(built.paths['/markets']?.get?.['x-stability-level']).toBeUndefined();
    expect(built.paths['/stories']?.get?.['x-stability-level']).toBe('beta');
    for (const path of [
      '/stories/later',
      '/owner/agent',
      '/reader/chat',
      '/admin/social/save',
      '/unfinished',
    ]) {
      expect(built.paths[path], path).toBeUndefined();
    }
  });
});
