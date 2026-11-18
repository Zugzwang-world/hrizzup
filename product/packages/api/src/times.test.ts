import { readdirSync, readFileSync } from 'node:fs';
import { shapes } from '@hrizzup/agreement';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { contract } from './contract.ts';
import * as examples from './examples.ts';
import { isPublished, isSocialCall, procedures } from './procedures.ts';
import {
  FREE_TEXT_PATHS,
  mapTimes,
  PRINTED_TIME,
  printedTime,
  printingProblems,
  printTimes,
  timePlan,
  timesIn,
} from './times.ts';

/**
 * Every time the API prints has exactly three decimals (the founder's rule, 18 November 2026), done
 * in one place, `printTimes`, which `product/web/lib/api/base.ts` calls on every answer. These tests
 * hold the printer to it with no database: the printing itself, that every call's output is read,
 * and, for every call that prints a time (the list is derived from the contract, so a new call
 * can't be missed), that its example answer prints right, whatever form a package wrote its times in.
 * The website's own calls (never mocked away from the real middleware) are in
 * product/web/app/api/v1/[[...rest]]/times.test.ts; real answers in the packages' *.db.test.ts.
 */

type Call = (typeof contract)['health'];
const calls = procedures(contract) as unknown as [string, Call][];
const outputOf = (call: Call) => call['~orpc'].outputSchema;
const isSocial = (name: string) => isSocialCall(name.split('.'));

describe('printedTime', () => {
  it.each([
    ['2026-11-09T06:30:00Z', '2026-11-09T06:30:00.000Z'],
    ['2026-11-09T06:30:00.3Z', '2026-11-09T06:30:00.300Z'],
    ['2026-11-09T06:30:00.12Z', '2026-11-09T06:30:00.120Z'],
    ['2026-11-09T06:30:00.123Z', '2026-11-09T06:30:00.123Z'],
    ['2026-11-09T06:30:00.123456Z', '2026-11-09T06:30:00.123Z'],
    // Cut, never rounded: the same second, the same year.
    ['2026-12-31T23:59:59.9999Z', '2026-12-31T23:59:59.999Z'],
    ['2026-12-31T23:59:59.999999Z', '2026-12-31T23:59:59.999Z'],
  ])('prints %s as %s', (given, printed) => {
    expect(printedTime(given)).toBe(printed);
    expect(printed).toMatch(PRINTED_TIME);
  });

  it("says what `new Date(x).toISOString()` does, for 0 to 9 decimals and the second's edges", () => {
    for (const head of ['2026-11-09T06:30:12', '2026-12-31T23:59:59', '2028-02-29T00:00:00']) {
      for (const digits of ['', '9', '99', '999', '9999', '5', '0007', '123456', '999999999']) {
        const time = `${head}${digits ? `.${digits}` : ''}Z`;
        expect(printedTime(time), time).toBe(new Date(time).toISOString());
      }
    }
  });

  it('changes nothing when it is printed again, and leaves text that is not a time in UTC alone', () => {
    const once = printedTime('2026-11-09T06:30:00.12Z');
    expect(printedTime(once)).toBe(once);
    for (const text of [
      '',
      'soon',
      '2026-11-09',
      '2026-11-09T06:30:00+05:30',
      '2026-11-09T06:30:00.123+00:00',
      '2026-11-09T06:30:00.Z',
      ' 2026-11-09T06:30:00Z',
      'at 2026-11-09T06:30:00Z',
    ]) {
      expect(printedTime(text), text).toBe(text);
    }
  });
});

describe('how a time is found (by the schema, never by how a string looks)', () => {
  const time = z.iso.datetime();

  it('reads a datetime however it is wrapped, and nothing else', () => {
    const schema = z.object({
      at: time,
      maybe: time.optional(),
      never: time.nullable(),
      fixed: time.default('2026-11-09T06:30:00.000Z'),
      once: time.readonly(),
      checked: time.refine(() => true),
      older: z.string().datetime(),
      list: z.array(z.object({ at: time })),
      grid: z.array(z.array(time)),
      text: z.string(),
      number: z.number(),
      day: z.iso.date(),
      pick: z.enum(['a', 'b']),
    });
    const plan = timePlan(schema);
    expect(plan.unknown).toEqual([]);
    expect(plan.paths).toEqual([
      'at',
      'maybe',
      'never',
      'fixed',
      'once',
      'checked',
      'older',
      'list[].at',
      'grid[][]',
    ]);
  });

  it('prints each of them, adds no key, keeps the key order, and changes nothing it was given', () => {
    const schema = z.object({
      b: z.string(),
      at: time,
      maybe: time.optional(),
      never: time.nullable(),
      list: z.array(z.object({ at: time, note: z.string() })),
    });
    const given = Object.freeze({
      b: '2026-11-09T06:30:00Z',
      at: '2026-11-09T06:30:00Z',
      never: null,
      list: Object.freeze([
        Object.freeze({ at: '2026-11-09T06:30:00.3Z', note: '2026-11-09T06:30:00Z' }),
      ]),
    });
    const printed = printTimes(schema, given);
    expect(printed).toEqual({
      b: '2026-11-09T06:30:00Z',
      at: '2026-11-09T06:30:00.000Z',
      never: null,
      list: [{ at: '2026-11-09T06:30:00.300Z', note: '2026-11-09T06:30:00Z' }],
    });
    expect(Object.keys(printed)).toEqual(['b', 'at', 'never', 'list']);
    expect(Object.hasOwn(printed, 'maybe')).toBe(false);
    expect(given.at).toBe('2026-11-09T06:30:00Z');
    expect(given.list[0]?.at).toBe('2026-11-09T06:30:00.3Z');
  });

  it('returns the value itself when its schema holds no time', () => {
    const schema = z.object({ text: z.string() });
    const given = { text: '2026-11-09T06:30:00Z' };
    expect(printTimes(schema, given)).toBe(given);
  });

  it('never throws, whatever the value is, and leaves what is not as the schema says', () => {
    const schema = z.object({
      at: z.iso.datetime(),
      list: z.array(z.object({ at: z.iso.datetime() })),
    });
    for (const value of [
      null,
      undefined,
      3,
      'text',
      true,
      [],
      {},
      { at: 4 },
      { at: null },
      { list: 'no' },
      { list: [null, 1, {}] },
    ]) {
      expect(() => printTimes(schema, value)).not.toThrow();
      expect(printTimes(schema, value)).toEqual(value);
    }
    expect(printTimes(schema, { at: 4, list: [null, { at: '2026-11-09T06:30:00Z' }] })).toEqual({
      at: 4,
      list: [null, { at: '2026-11-09T06:30:00.000Z' }],
    });
    for (const notASchema of [undefined, null, 4, 'text', {}, { _zod: null }]) {
      expect(() => printTimes(notASchema, { at: '2026-11-09T06:30:00Z' })).not.toThrow();
      expect(printTimes(notASchema, { at: '2026-11-09T06:30:00Z' })).toEqual({
        at: '2026-11-09T06:30:00Z',
      });
      expect(timePlan(notASchema).unknown).toEqual(['']);
    }
  });

  it('says what it cannot read, so a part it would leave alone is never missed', () => {
    const time = z.iso.datetime();
    const unreadable = {
      'a union holding a time': z.object({ x: z.union([time, z.number()]) }),
      'a record of times': z.object({ x: z.record(z.string(), time) }),
      'a tuple holding a time': z.object({ x: z.tuple([time, z.number()]) }),
      'an intersection holding a time': z.object({
        x: z.intersection(z.object({ a: time }), z.object({ b: z.string() })),
      }),
      'a catchall holding a time': z.object({ a: z.string() }).catchall(time),
      'a loose object': z.looseObject({ a: z.string() }),
      'a lazy part': z.object({ x: z.lazy(() => time) }),
      'a time to convert (an offset)': z.object({ x: z.iso.datetime({ offset: true }) }),
      'a local time': z.object({ x: z.iso.datetime({ local: true }) }),
      'a transform': z.object({ x: time.transform((value) => value) }),
      'any part': z.object({ x: z.any() }),
      'an unknown part': z.object({ x: z.unknown() }),
      'a custom check that is not the market record': z.object({ x: z.custom<string>() }),
    };
    for (const [what, schema] of Object.entries(unreadable)) {
      const plan = timePlan(schema);
      expect(plan.unknown.length, what).toBeGreaterThan(0);
    }
    // A union, record, tuple or intersection with no time inside it is nothing to read.
    const plain = z.object({
      a: z.union([z.string(), z.number()]),
      b: z.record(z.string(), z.number()),
      c: z.tuple([z.string(), z.number()]),
      d: z.intersection(z.object({ a: z.string() }), z.object({ b: z.string() })),
    });
    expect(timePlan(plain)).toEqual({ paths: [], unknown: [] });
    expect(timePlan(z.strictObject({ a: z.string() }))).toEqual({ paths: [], unknown: [] });
  });

  it("reads the market record by the agreement's own definition: its five times, nothing else", () => {
    const definition = shapes['market/1'] as { properties: Record<string, { $ref?: string }> };
    const times = Object.entries(definition.properties)
      .filter(([, property]) => property.$ref === 'common.schema.json#/$defs/time')
      .map(([key]) => key);
    expect(times.sort()).toEqual([
      'closes_at',
      'created_at',
      'opens_at',
      'settled_at',
      'updated_at',
    ]);
    const plan = timePlan(contract.markets.get['~orpc'].outputSchema);
    expect(plan.unknown).toEqual([]);
    expect(plan.paths.sort()).toEqual(times.map((key) => `market.${key}`).sort());
  });
});

describe('every call is understood', () => {
  it('has an output whose times are all read, in the contract as a whole (social included)', () => {
    expect(calls.length).toBeGreaterThan(50);
    for (const [name, call] of calls) {
      expect(outputOf(call), `${name} has an output schema`).toBeDefined();
      expect(
        timePlan(outputOf(call)).unknown,
        `${name}'s output holds a part it can't read`,
      ).toEqual([]);
    }
  });

  it("has no time in any of its errors' data", () => {
    for (const [name, call] of calls) {
      for (const [code, error] of Object.entries(call['~orpc'].errorMap) as [
        string,
        { data?: unknown },
      ][]) {
        if (!error?.data) continue;
        const plan = timePlan(error.data);
        expect(plan, `${name}'s ${code}`).toEqual({ paths: [], unknown: [] });
      }
    }
  });

  it('names the times the founder named: pinned, so the derived list can never come back empty', () => {
    const paths = (name: string) =>
      timePlan(outputOf(calls.find(([n]) => n === name)?.[1] as Call)).paths;
    expect(paths('health')).toContain('checkedAt');
    expect(paths('portfolio.orders')).toEqual(
      expect.arrayContaining(['orders[].expiresAt', 'orders[].createdAt']),
    );
    expect(paths('admin.perps.get')).toEqual(
      expect.arrayContaining(['standIn.origin', 'log[].at']),
    );
    expect(paths('markets.trade')).toContain('at');
    expect(paths('perps.open')).toEqual(
      expect.arrayContaining([
        'placedAt',
        'at',
        'priceAt',
        'position.openedAt',
        'position.updatedAt',
      ]),
    );
    expect(paths('keys.revoke')).toContain('revokedAt');
  });
});

/** Every call but social's that prints a time, and an example answer of each. */
const consolePerpPage = { perps: [examples.consolePerp], next: null };
const consoleMarketPage = { markets: [examples.consoleMarket], next: null };
const EXAMPLE_ANSWERS: Record<string, unknown> = {
  health: examples.health,
  'markets.list': examples.marketList,
  'markets.get': examples.oneMarket,
  'markets.history': examples.marketHistory,
  'markets.trades': examples.marketTrades,
  'markets.quote': examples.marketQuote,
  'markets.trade': examples.tradeResult,
  'perps.list': { perps: [examples.perpDetails] },
  'perps.get': examples.perpDetails,
  'perps.quote': examples.perpQuote,
  'perps.open': examples.perpOpened,
  'perps.close': examples.perpClosed,
  'prices.get': examples.price,
  'prices.history': examples.priceHistory,
  'portfolio.positions': examples.positionsPage,
  'portfolio.perps': examples.perpPositionsPage,
  'portfolio.trades': examples.myTradesPage,
  'portfolio.orders': examples.ordersPage,
  'keys.list': examples.keyList,
  'keys.create': examples.createdKey,
  'keys.revoke': examples.revokedKey,
  'admin.markets.list': consoleMarketPage,
  'admin.markets.get': examples.consoleMarketWithLog,
  'admin.markets.create': examples.consoleMarketWithLog,
  'admin.markets.open': examples.consoleMarketWithLog,
  'admin.markets.close': examples.consoleMarketWithLog,
  'admin.markets.settle': examples.consoleMarketWithLog,
  'admin.perps.list': consolePerpPage,
  'admin.perps.get': examples.consolePerpWithLog,
  'admin.perps.setMode': examples.consolePerpWithLog,
  'admin.perps.setSettings': examples.consolePerpWithLog,
  'admin.perps.createTest': examples.consolePerpWithLog,
  'admin.perps.retireTest': examples.consolePerpWithLog,
};

/** The calls but social's whose answer holds a time, from the contract itself. */
const PRINTING = calls
  .filter(([name, call]) => !isSocial(name) && timePlan(outputOf(call)).paths.length > 0)
  .map(([name]) => name);

/** The free text that may read like a time: today only the perp log's old and new value of a rule. */
const FREE_TEXT = new Set(FREE_TEXT_PATHS);

const ISO_LOOKING = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/** Every place in an answer where a string reads like a time, as `path[]`. */
function looksLikeATime(value: unknown, path = ''): string[] {
  if (typeof value === 'string') return ISO_LOOKING.test(value) ? [path] : [];
  if (Array.isArray(value)) return value.flatMap((item) => looksLikeATime(item, `${path}[]`));
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, inner]) =>
      looksLikeATime(inner, path ? `${path}.${key}` : key),
    );
  }
  return [];
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

async function passes(call: Call, value: unknown) {
  const result = (await call['~orpc'].outputSchema?.['~standard'].validate(value)) as {
    issues?: unknown[];
  };
  expect(result.issues, JSON.stringify(result.issues)).toBeUndefined();
}

describe('every call that prints a time', () => {
  it("is in the examples' list below, and that list holds no other call", () => {
    expect(PRINTING.length).toBeGreaterThan(30);
    expect([...PRINTING].sort()).toEqual(Object.keys(EXAMPLE_ANSWERS).sort());
  });

  it.each(PRINTING)(
    '%s: its example answer is printed, and any form of time a package wrote is printed to it',
    async (name) => {
      const call = calls.find(([n]) => n === name)?.[1] as Call;
      const schema = outputOf(call);
      const example = EXAMPLE_ANSWERS[name];
      const plan = timePlan(schema);
      await passes(call, example);

      // The example is what the API answers: every time in it has three decimals.
      const given = timesIn(schema, example);
      expect(given.length, `${name}'s example holds no time`).toBeGreaterThan(0);
      for (const { path, time } of given) expect(time, `${name}: ${path}`).toMatch(PRINTED_TIME);

      // The database's forms planted at every place a time is, cycling through the three ways it writes one.
      let count = 0;
      const planted = deepFreeze(
        mapTimes(schema, structuredClone(example), (time) => {
          const head = time.slice(0, 19);
          return [`${head}Z`, `${head}.3Z`, `${head}.123456Z`][count++ % 3] as string;
        }),
      );
      const before = JSON.stringify(planted);
      const printed = printTimes(schema, planted);
      expect(JSON.stringify(planted), 'the value it was given changed').toBe(before);

      const raw = new Map(timesIn(schema, planted).map(({ path, time }) => [path, time]));
      const out = timesIn(schema, printed);
      expect(out.map(({ path }) => path)).toEqual([...raw.keys()]);
      for (const { path, time } of out) {
        expect(time, `${name}: ${path}`).toBe(new Date(raw.get(path) as string).toISOString());
        expect(time).toMatch(PRINTED_TIME);
      }

      // Nothing but the times changed.
      const masked = (value: unknown) => mapTimes(schema, value, () => '<time>');
      expect(masked(printed)).toEqual(masked(planted));

      // It is still a valid answer, and printing it again changes nothing.
      await passes(call, printed);
      expect(printTimes(schema, printed)).toEqual(printed);

      // No other time is printed over: only the times the schema names, bar the named free text.
      const named = new Set(plan.paths);
      for (const path of looksLikeATime(printed)) {
        expect(
          named.has(path) || FREE_TEXT.has(path),
          `${name}: ${path} reads like a time and isn't one`,
        ).toBe(true);
      }
    },
  );
});

describe('free text is never printed over', () => {
  it("keeps a market's question, rules and the page's `next` that read like a time", () => {
    const [first] = examples.marketList.markets;
    if (!first) throw new Error('no example market');
    const text = 'Will it happen by 2026-12-31T00:00:00Z or 2026-12-31T00:00:00.5Z?';
    const record = {
      ...first.market,
      question: text,
      rules: text,
      opens_at: '2026-11-09T06:30:00Z',
    };
    const given = { markets: [{ ...first, market: record }], next: `cursor-${text}` };
    const printed = printTimes(contract.markets.list['~orpc'].outputSchema, given);
    expect(printed.markets[0]?.market.opens_at).toBe('2026-11-09T06:30:00.000Z');
    expect(printed.markets[0]?.market.question).toBe(text);
    expect(printed.markets[0]?.market.rules).toBe(text);
    expect(printed.next).toBe(given.next);
  });

  it("keeps a rule change's old and new value, and a source's name, that read like a time", () => {
    const [change] = examples.consolePerpWithLog.log;
    if (!change) throw new Error('no example log line');
    const given = {
      ...examples.consolePerpWithLog,
      log: [
        {
          ...change,
          rule: 'funding_from' as const,
          oldValue: '2026-11-10T10:30:00Z',
          newValue: '2026-11-10T10:30:00.5Z',
        },
      ],
    };
    const printed = printTimes(contract.admin.perps.get['~orpc'].outputSchema, given);
    expect(printed.log[0]?.oldValue).toBe('2026-11-10T10:30:00Z');
    expect(printed.log[0]?.newValue).toBe('2026-11-10T10:30:00.5Z');
    expect(printed.log[0]?.at).toBe(change.at);

    const market = {
      ...examples.consoleMarketWithLog,
      source: { name: 'The log of 2026-11-10T10:30:00Z' },
    };
    const shown = printTimes(contract.admin.markets.get['~orpc'].outputSchema, market);
    expect(shown.source.name).toBe('The log of 2026-11-10T10:30:00Z');
  });
});

describe('printingProblems, which the database tests run real answers through', () => {
  const schema = z.object({
    at: z.iso.datetime(),
    list: z.array(z.object({ at: z.iso.datetime() })),
  });

  it('finds nothing wrong with an answer whose times print right, whatever form they came in', () => {
    for (const at of [
      '2026-11-09T06:30:00Z',
      '2026-11-09T06:30:00.3Z',
      '2026-11-09T06:30:00.123456Z',
    ]) {
      expect(printingProblems(schema, { at, list: [{ at }, { at }] })).toEqual([]);
    }
    expect(printingProblems(schema, { at: '2026-11-09T06:30:00Z', list: [] })).toEqual([]);
  });

  it('names a time the schema does not, text that reads like a time, and a part it cannot read', () => {
    expect(
      printingProblems(schema, {
        at: '2026-11-09T06:30:00Z',
        list: [],
        other: '2026-11-09T06:30:00Z',
      }),
    ).toEqual(["other: reads like a time, but the schema doesn't name it"]);
    expect(printingProblems(schema, { at: 'soon', list: [] })).toEqual([
      'at: soon is not a time',
      'at: soon has not three decimals',
    ]);
    expect(printingProblems(undefined, { at: '2026-11-09T06:30:00Z' })).toEqual([
      "at: reads like a time, but the schema doesn't name it",
    ]);
  });

  it("exempts only the perp log's old and new value", () => {
    expect([...FREE_TEXT_PATHS]).toEqual(['log[].oldValue', 'log[].newValue']);
    const perp = {
      ...examples.consolePerpWithLog,
      log: [
        { ...(examples.consolePerpWithLog.log[0] as object), oldValue: '2026-11-10T10:30:00Z' },
      ],
    };
    expect(printingProblems(contract.admin.perps.get['~orpc'].outputSchema, perp)).toEqual([]);
  });
});

describe('the real database covers every call that prints a time', () => {
  it("has each published one but health in some package's *.db.test.ts, so the real answers are checked", () => {
    const packages = new URL('../../', import.meta.url);
    const files = readdirSync(packages, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const src = new URL(`${entry.name}/src/`, packages);
        try {
          return readdirSync(src)
            .filter((file) => file.endsWith('.db.test.ts'))
            .map((file) => readFileSync(new URL(file, src), 'utf8'));
        } catch {
          return [];
        }
      });
    expect(files.length).toBeGreaterThan(5);
    const published = calls
      .filter(([name, call]) => PRINTING.includes(name) && isPublished(name.split('.'), call))
      .map(([name]) => name)
      .filter((name) => name !== 'health');
    expect(published.length).toBe(17);
    for (const name of published) {
      const found = files.some((file) =>
        new RegExp(`contract\\.${name.replace('.', '\\.')}\\b`).test(file),
      );
      expect(found, `${name} is in no database test`).toBe(true);
    }
  });
});
