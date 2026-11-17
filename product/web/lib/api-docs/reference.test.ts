import openapi from '@hrizzup/api/openapi.json' with { type: 'json' };
import { describe, expect, it } from 'vitest';
import { callText, fullText, llmsText } from './markdown.ts';
import { BETA_NOTE, calls, callsOf, type Document, kindOf, server } from './reference.ts';

const call = (id: string) => {
  const found = calls.find((c) => c.id === id);
  if (!found) throw new Error(`No call ${id}`);
  return found;
};

describe("the public API's reference, read from its OpenAPI file", () => {
  it('has every public call, on staging, each saying whether it needs a key', () => {
    expect(server).toBe('https://staging.hrizzup.com/api/v1');
    expect(calls.map((c) => c.id)).toContain('markets.list');
    expect(calls.some((c) => c.path.startsWith('/admin'))).toBe(false);
    expect(call('markets.list').needsKey).toBe(false);
    expect(call('portfolio.positions').needsKey).toBe(true);
  });

  it('says what each call takes: the paging inputs, and a trade as a buy or a sale', () => {
    expect(call('markets.list').takes.query.map((f) => f.name)).toEqual(['cursor', 'limit']);
    expect(call('markets.list').takes.query[1]?.kind).toBe('a whole number (1 to 100)');
    const trade = call('markets.trade').takes.body;
    expect(trade.map((v) => v.when)).toEqual([
      'action is "buy"',
      'action is "sell"',
      `action is "buy", in Manifold's form: YES or NO, and dryRun`,
      `action is "sell", in Manifold's form: YES or NO, and dryRun`,
    ]);
    expect(trade[0]?.fields.find((f) => f.name === 'amount')).toMatchObject({
      required: true,
      kind: 'an amount, as text, more than 0, to 6 decimal places',
    });
    expect(call('perps.get').takes.path.map((f) => f.name)).toEqual(['id']);
  });

  it('says what each call answers, nested fields named with dots and lists with []', () => {
    const names = call('portfolio.positions').answers.map((f) => f.name);
    expect(names).toEqual(
      expect.arrayContaining(['balance', 'positions', 'positions[].marketId', 'next']),
    );
    const market = call('markets.list').answers.find((f) => f.name === 'markets[].market');
    expect(market?.kind).toMatch(/market\/1/);
    expect(call('markets.trade').answers.map((f) => f.name)).toContain('position.yes');
  });

  it("lists each call's errors, in the one format's codes", () => {
    const codes = call('markets.trade').errors.map((e) => `${e.status} ${e.code}`);
    expect(codes).toEqual(
      expect.arrayContaining([
        '400 BAD_REQUEST',
        '401 UNAUTHORIZED',
        '403 FORBIDDEN',
        '422 REFUSED',
        '429 TOO_MANY_REQUESTS',
        '503 SERVICE_UNAVAILABLE',
      ]),
    );
  });

  it('names kinds in words', () => {
    expect(kindOf({ type: 'string', format: 'date-time' })).toBe('a time (ISO 8601, UTC)');
    expect(kindOf({ anyOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] })).toBe(
      'a UUID, or null',
    );
    expect(kindOf({ enum: ['yes', 'no'], type: 'string' })).toBe('"yes" or "no"');
  });
});

describe('the docs as text, for AI tools', () => {
  it("llms.txt has the llmstxt.org shape: a name, a summary, and its links, pointing at staging's docs, the text and the file", () => {
    const text = llmsText();
    expect(text).toMatch(/^# Hrizzup API\n\n> /);
    expect(text).toContain('https://staging.hrizzup.com/docs');
    expect(text).toContain('https://staging.hrizzup.com/llms-full.txt');
    expect(text).toContain('https://staging.hrizzup.com/api/v1/openapi.json');
    expect(text).toMatch(/play money only, keys that work only here, and data that may be reset/);
  });

  it('llms-full.txt holds the guides and every call', () => {
    const text = fullText();
    for (const c of calls) expect(text).toContain(`### ${c.method} ${c.path}`);
    expect(text).toContain('## Moving from Manifold');
    expect(text).toContain('## Changelog');
  });
});

describe('a call in beta', () => {
  // The real file has no call in beta until social's calls join it: a small file shows the rest.
  const answers = {
    '200': {
      content: {
        'application/json': {
          schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
        },
      },
    },
  };
  const small: Document = {
    info: { title: 'Small', version: '1.0.0', description: '' },
    servers: [{ url: 'https://example.test/api/v1' }],
    paths: {
      '/markets': {
        get: { operationId: 'markets.list', summary: 'The markets', responses: answers },
      },
      '/stories': {
        get: {
          operationId: 'stories.list',
          summary: 'The stories',
          'x-stability-level': 'beta',
          responses: answers,
        },
      },
      '/stories/{id}': {
        get: {
          operationId: 'stories.get',
          summary: 'One story',
          'x-stability-level': 'stable',
          responses: answers,
        },
      },
    },
    components: { schemas: {} },
  };
  const [stable, beta, other] = callsOf(small);

  it('is the call whose operation says `x-stability-level: beta`, and no other', () => {
    expect([stable?.beta, beta?.beta, other?.beta]).toEqual([false, true, false]);
    expect(beta?.id).toBe('stories.list');
    // The real file's calls follow its marks exactly.
    const marked = Object.values(openapi.paths)
      .flatMap((item) => Object.values(item as Record<string, Record<string, unknown>>))
      .filter((operation) => operation['x-stability-level'] === 'beta')
      .map((operation) => operation.operationId);
    expect(calls.filter((c) => c.beta).map((c) => c.id)).toEqual(marked);
  });

  it('says Beta in the text for AI tools, under its heading, and says nothing of a call that is not', () => {
    const text = callText(beta as NonNullable<typeof beta>);
    expect(text).toMatch(/^### GET \/stories\n\n\*\*Beta\.\*\* .*change/);
    expect(text).toContain(BETA_NOTE);
    expect(callText(stable as NonNullable<typeof stable>)).not.toMatch(/beta/i);
    expect(callText(other as NonNullable<typeof other>)).not.toMatch(/beta/i);
  });
});
