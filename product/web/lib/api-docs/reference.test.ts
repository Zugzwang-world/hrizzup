import { describe, expect, it } from 'vitest';
import { fullText, llmsText } from './markdown.ts';
import { calls, kindOf, server } from './reference.ts';

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
