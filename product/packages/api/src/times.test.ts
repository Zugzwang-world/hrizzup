import { shapes } from '@hrizzup/agreement';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { contract } from './contract.ts';
import * as examples from './examples.ts';
import { isSocialCall, procedures } from './procedures.ts';
import { callExamples } from './social/examples.ts';
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
      for (let length = 0; length <= 9; length++) {
        for (const fraction of ['123456789', '999999999', '000000007', '500000000']) {
          const digits = fraction.slice(0, length);
          const time = `${head}${digits ? `.${digits}` : ''}Z`;
          expect(printedTime(time), time).toBe(new Date(time).toISOString());
        }
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

  it('reads a schema once, whatever the number of answers printed with it', () => {
    const schema = z.object({ at: time, list: z.array(z.object({ at: time })) });
    // Count each read of the schema's own shape: the compiled plan is kept for the schema object.
    const def = schema._zod.def as { shape: unknown };
    const shape = def.shape;
    let reads = 0;
    Object.defineProperty(def, 'shape', {
      configurable: true,
      get: () => {
        reads++;
        return shape;
      },
    });
    const answer = { at: '2026-11-09T06:30:00Z', list: [{ at: '2026-11-09T06:30:00.5Z' }] };
    for (let i = 0; i < 5; i++) {
      expect(printTimes(schema, answer)).toEqual({
        at: '2026-11-09T06:30:00.000Z',
        list: [{ at: '2026-11-09T06:30:00.500Z' }],
      });
    }
    expect(timePlan(schema).paths).toEqual(['at', 'list[].at']);
    expect(timesIn(schema, answer)).toHaveLength(2);
    // The shape was read to build the plan, and by nothing after.
    expect(reads).toBeGreaterThan(0);
    const built = reads;
    printTimes(schema, answer);
    mapTimes(schema, answer, (value) => value);
    expect(reads).toBe(built);
    // A second schema object is its own plan, and an unreadable one is never kept.
    expect(timePlan(z.object({ at: time })).paths).toEqual(['at']);
    expect(timePlan(undefined).unknown).toEqual(['']);
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
    // Social's: the check-in's moment and the mark an agent sends back, and the story read's.
    expect(paths('social.me.checkin')).toEqual(expect.arrayContaining(['asOf', 'since']));
    expect([...paths('social.me.checkinDone')].sort()).toEqual(['at', 'seenUntil']);
    expect(paths('social.stories.get')).toEqual(
      expect.arrayContaining(['createdAt', 'latestAt', 'updates[].reportedAt']),
    );
    expect(paths('admin.social.invites.create')).toEqual(
      expect.arrayContaining(['invite.createdAt', 'invite.expiresAt']),
    );
  });
});

/** Every call that prints a time, and an example answer of each: the market's here, social's from its own examples. */
const consolePerpPage = { perps: [examples.consolePerp], next: null };
const consoleMarketPage = { markets: [examples.consoleMarket], next: null };
const MARKET_ANSWERS: Record<string, unknown> = {
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

/**
 * Some of social's calls may answer a time that the example, as it should, leaves null (a key's claim
 * time, when a limit lifts, a preview's post that isn't saved, a reader's pause, in the state and in the
 * reply to a message): the same answer with each of those times filled in, so the example the test prints
 * holds them.
 */
const FILLED_TIME = '2026-11-18T08:00:00.000Z';
const FILLED: Record<string, string[]> = {
  'social.me.get': ['claimExpiresAt', 'limits.nextPostAt', 'limits.nextReplyAt'],
  'social.me.preview': ['card.createdAt'],
  'reader.get': ['usage.pausedUntil'],
  'reader.saveProfile': ['usage.pausedUntil'],
  'reader.chat.send': ['usage.pausedUntil'],
};

/** The times an example holds itself, because the call always answers them (a reader's `usage.resetsAt`): never filled. */
const HELD: Record<string, string[]> = {
  'reader.get': ['usage.resetsAt'],
  'reader.saveProfile': ['usage.resetsAt'],
  'reader.chat.send': ['message.createdAt', 'reply.createdAt', 'usage.resetsAt'],
};

function withTimesFilled(answer: unknown, paths: readonly string[]): unknown {
  const copy = structuredClone(answer) as Record<string, unknown>;
  for (const path of paths) {
    const keys = path.split('.');
    const last = keys.pop() as string;
    let place = copy;
    for (const key of keys) place = place[key] as Record<string, unknown>;
    place[last] = FILLED_TIME;
  }
  return copy;
}

/**
 * Social's example answers (its own examples, `social/examples/*.json`, joined by `callExamples`), of the
 * calls whose answer holds a time. Taken from the examples, never from the list below, so a call with
 * a time and no example can't hide: the two lists must have the same names.
 */
const SOCIAL_ANSWERS: Record<string, unknown> = Object.fromEntries(
  Object.entries(callExamples)
    .filter(([name]) => {
      const call = calls.find(([called]) => called === name)?.[1];
      return call !== undefined && timePlan(outputOf(call)).paths.length > 0;
    })
    .map(([name, example]) => [name, withTimesFilled(example.output, FILLED[name] ?? [])]),
);
const EXAMPLE_ANSWERS: Record<string, unknown> = { ...MARKET_ANSWERS, ...SOCIAL_ANSWERS };

/** The calls whose answer holds a time, from the contract itself: social's and the market's. */
const PRINTING = calls
  .filter(([, call]) => timePlan(outputOf(call)).paths.length > 0)
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

describe('a discriminated union (a choice of shapes told apart by one field)', () => {
  const time = z.iso.datetime();
  const live = z.object({
    state: z.literal('live'),
    at: time,
    list: z.array(z.object({ at: time })),
    name: z.string(),
  });
  const gone = z.object({
    state: z.literal('withdrawn'),
    reason: z.string().nullable(),
    since: time,
  });
  const quiet = z.object({ state: z.literal('quiet'), note: z.string() });
  const story = z.discriminatedUnion('state', [live, gone, quiet]);

  const aLive = {
    state: 'live',
    at: '2026-11-09T06:30:00Z',
    list: [{ at: '2026-11-09T06:30:00.5Z' }],
    name: 'a story',
  };
  const aGone = { state: 'withdrawn', reason: null, since: '2026-11-09T06:30:00.123456Z' };
  const aQuiet = { state: 'quiet', note: 'a note' };
  // Free text that reads like a time, in the option that has none and in one that has.
  const lookalike = { ...aLive, name: '2026-11-09T06:30:00Z' };
  const quietLookalike = { ...aQuiet, note: '2026-11-09T06:30:00Z' };

  it('reads the times of each option, each path once, and says nothing it cannot read', () => {
    expect(timePlan(story)).toEqual({ paths: ['at', 'list[].at', 'since'], unknown: [] });
    // A time at the same place in two options is listed once.
    const both = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('a'), at: time }),
      z.object({ kind: z.literal('b'), at: time, also: time }),
    ]);
    expect(timePlan(both)).toEqual({ paths: ['at', 'also'], unknown: [] });
    // An option can fix its discriminator to several values, or to a number.
    const many = z.discriminatedUnion('n', [
      z.object({ n: z.literal([1, 2]), at: time }),
      z.object({ n: z.literal(3) }),
    ]);
    expect(timePlan(many)).toEqual({ paths: ['at'], unknown: [] });
    // Nothing to print: nothing to read.
    expect(
      timePlan(
        z.discriminatedUnion('kind', [
          z.object({ kind: z.literal('a'), x: z.string() }),
          z.object({ kind: z.literal('b') }),
        ]),
      ),
    ).toEqual({ paths: [], unknown: [] });
    // The part of an option it cannot read is named, by the path it has there.
    const odd = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('a'), at: time }),
      z.object({ kind: z.literal('b'), grid: z.record(z.string(), time) }),
    ]);
    expect(timePlan(odd)).toEqual({ paths: ['at'], unknown: ['grid'] });
  });

  it("prints the times of the option the value's own discriminator picks, and no other", () => {
    expect(printTimes(story, lookalike)).toEqual({
      state: 'live',
      at: '2026-11-09T06:30:00.000Z',
      list: [{ at: '2026-11-09T06:30:00.500Z' }],
      // Free text that reads like a time is left as it is.
      name: '2026-11-09T06:30:00Z',
    });
    expect(printTimes(story, aGone)).toEqual({
      state: 'withdrawn',
      reason: null,
      since: '2026-11-09T06:30:00.123Z',
    });
    // A field of another option, on a value that picks this one, is not a time here.
    expect(printTimes(story, { ...aLive, since: '2026-11-09T06:30:00Z' })).toMatchObject({
      since: '2026-11-09T06:30:00Z',
    });
    expect(timesIn(story, aLive)).toEqual([
      { path: 'at', time: '2026-11-09T06:30:00Z' },
      { path: 'list[0].at', time: '2026-11-09T06:30:00.5Z' },
    ]);
    expect(timesIn(story, aGone)).toEqual([{ path: 'since', time: '2026-11-09T06:30:00.123456Z' }]);
    // An option with no time comes back as the very value, its text that reads like a time untouched.
    expect(printTimes(story, quietLookalike)).toBe(quietLookalike);
    expect(timesIn(story, quietLookalike)).toEqual([]);
    expect(printingProblems(story, aLive)).toEqual([]);
    expect(printingProblems(story, aGone)).toEqual([]);
  });

  it('leaves a value as it is, never throwing, when it picks no option', () => {
    const picks = [
      'a string',
      7,
      null,
      undefined,
      true,
      [aLive],
      {},
      { at: '2026-11-09T06:30:00Z' }, // no discriminator
      { state: undefined, at: '2026-11-09T06:30:00Z' },
      { state: null, at: '2026-11-09T06:30:00Z' },
      { state: true, at: '2026-11-09T06:30:00Z' },
      { state: { is: 'live' }, at: '2026-11-09T06:30:00Z' },
      { state: ['live'], at: '2026-11-09T06:30:00Z' },
      { state: 'other', at: '2026-11-09T06:30:00Z', since: '2026-11-09T06:30:00Z' },
      { state: 7, at: '2026-11-09T06:30:00Z' },
      { state: 'LIVE', at: '2026-11-09T06:30:00Z' },
    ];
    for (const value of picks) {
      expect(() => printTimes(story, value), JSON.stringify(value)).not.toThrow();
      expect(printTimes(story, value), JSON.stringify(value)).toBe(value);
      expect(
        mapTimes(story, value, () => 'X'),
        JSON.stringify(value),
      ).toBe(value);
      expect(timesIn(story, value), JSON.stringify(value)).toEqual([]);
    }
    // A number discriminator picks by number only, never by the same digits as text.
    const numbered = z.discriminatedUnion('n', [
      z.object({ n: z.literal(1), at: time }),
      z.object({ n: z.literal(2) }),
    ]);
    expect(printTimes(numbered, { n: 1, at: '2026-11-09T06:30:00Z' })).toEqual({
      n: 1,
      at: '2026-11-09T06:30:00.000Z',
    });
    const text = { n: '1', at: '2026-11-09T06:30:00Z' };
    expect(printTimes(numbered, text)).toBe(text);
  });

  it('copies what it changes and never changes what it was given', () => {
    const given = deepFreeze(structuredClone({ story: aLive, items: [aGone, aQuiet, aLive] }));
    const nested = z.object({ story, items: z.array(story) });
    const before = JSON.stringify(given);
    const printed = printTimes(nested, given);
    expect(JSON.stringify(given)).toBe(before);
    expect(printed).not.toBe(given);
    expect(printed.story).not.toBe(given.story);
    expect(printed.story.at).toBe('2026-11-09T06:30:00.000Z');
    expect(given.story.at).toBe('2026-11-09T06:30:00Z');
    // The key order is kept, and a part that holds no time is the very part it was.
    expect(Object.keys(printed.story)).toEqual(Object.keys(given.story));
    expect(printed.items[1]).toBe(given.items[1]);
    expect(printed.items[0]).not.toBe(given.items[0]);
    expect(printingProblems(nested, given)).toEqual([]);
  });

  it('works the same inside an object or a list, at any depth', () => {
    const inside = z.object({
      story,
      items: z.array(story),
      deeper: z.object({ list: z.array(z.object({ one: story.nullable() })) }),
    });
    expect(timePlan(inside)).toEqual({
      paths: [
        'story.at',
        'story.list[].at',
        'story.since',
        'items[].at',
        'items[].list[].at',
        'items[].since',
        'deeper.list[].one.at',
        'deeper.list[].one.list[].at',
        'deeper.list[].one.since',
      ],
      unknown: [],
    });
    const answer = {
      story: aGone,
      items: [aLive, aQuiet, aGone, { state: 'other' }],
      deeper: { list: [{ one: aLive }, { one: null }] },
    };
    expect(printTimes(inside, answer)).toEqual({
      story: { ...aGone, since: '2026-11-09T06:30:00.123Z' },
      items: [
        { ...aLive, at: '2026-11-09T06:30:00.000Z', list: [{ at: '2026-11-09T06:30:00.500Z' }] },
        aQuiet,
        { ...aGone, since: '2026-11-09T06:30:00.123Z' },
        { state: 'other' },
      ],
      deeper: {
        list: [
          {
            one: {
              ...aLive,
              at: '2026-11-09T06:30:00.000Z',
              list: [{ at: '2026-11-09T06:30:00.500Z' }],
            },
          },
          { one: null },
        ],
      },
    });
    expect(timesIn(inside, answer).map(({ path }) => path)).toEqual([
      'story.since',
      'items[0].at',
      'items[0].list[0].at',
      'items[2].since',
      'deeper.list[0].one.at',
      'deeper.list[0].one.list[0].at',
    ]);
    expect(printingProblems(inside, answer)).toEqual([]);
  });

  it('keeps the rule for a union without a discriminator: a union that holds a time is not read', () => {
    const asked = [
      z.union([time, z.number()]),
      z.union([
        z.object({ kind: z.literal('a'), at: time }),
        z.object({ kind: z.literal('b'), at: time }),
      ]),
    ];
    for (const schema of asked) {
      expect(timePlan(schema).unknown.length).toBeGreaterThan(0);
      expect(timePlan(schema).paths).toEqual([]);
      const value = { kind: 'a', at: '2026-11-09T06:30:00Z' };
      expect(printTimes(schema, value)).toBe(value);
    }
    // A plain union with no time in it is nothing to read, as before.
    expect(timePlan(z.union([z.string(), z.number()]))).toEqual({ paths: [], unknown: [] });
    expect(timePlan(z.object({ x: z.union([time, z.number()]) })).unknown).toEqual(['x']);
  });

  it('is not read when an option is not an object with a literal discriminator: the whole union is unknown', () => {
    const named = [
      // An enum is not a literal.
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('a'), at: time }),
        z.object({ kind: z.enum(['b', 'c']), at: time }),
      ]),
      // Nor is a boolean one read, nor a value that two options fix.
      z.discriminatedUnion('ok', [
        z.object({ ok: z.literal(true), at: time }),
        z.object({ ok: z.literal(false) }),
      ]),
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('a'), at: time }),
        z.object({ kind: z.literal('a'), x: z.string() }),
      ]),
    ];
    for (const schema of named) {
      expect(timePlan(schema)).toEqual({ paths: [], unknown: [''] });
      const value = { kind: 'a', ok: true, at: '2026-11-09T06:30:00Z' };
      expect(printTimes(schema, value)).toBe(value);
    }
    // An option that is no object at all (made by hand: zod makes none).
    const crafted = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('a'), at: time }),
      z.object({ kind: z.literal('b') }),
    ]);
    (crafted._zod.def as { options: unknown[] }).options = [
      z.object({ kind: z.literal('a'), at: time }),
      time,
    ];
    expect(timePlan(crafted).unknown.length).toBeGreaterThan(0);
    // And inside an object the part is named by its path, and the rest still prints.
    const wrapped = z.object({ ok: time, choice: named[0] as z.ZodType });
    expect(timePlan(wrapped)).toEqual({ paths: ['ok'], unknown: ['choice'] });
    expect(printTimes(wrapped, { ok: '2026-11-09T06:30:00Z', choice: { kind: 'a' } })).toEqual({
      ok: '2026-11-09T06:30:00.000Z',
      choice: { kind: 'a' },
    });
  });

  it('is read once for the schema, in the same cache, whatever the number of answers printed', () => {
    const watched = z.discriminatedUnion('state', [
      z.object({ state: z.literal('live'), at: time }),
      z.object({ state: z.literal('withdrawn'), since: time }),
    ]);
    const counts = { live: 0, gone: 0 };
    const options = (watched._zod.def as unknown as { options: { _zod: { def: object } }[] })
      .options;
    for (const [index, key] of [
      [0, 'live'],
      [1, 'gone'],
    ] as const) {
      const def = options[index]?._zod.def as { shape: unknown };
      const shape = def.shape;
      Object.defineProperty(def, 'shape', {
        configurable: true,
        get: () => {
          counts[key]++;
          return shape;
        },
      });
    }
    const answer = { state: 'live', at: '2026-11-09T06:30:00Z' };
    for (let i = 0; i < 5; i++) {
      expect(printTimes(watched, answer)).toEqual({
        state: 'live',
        at: '2026-11-09T06:30:00.000Z',
      });
    }
    expect(timePlan(watched).paths).toEqual(['at', 'since']);
    expect(timesIn(watched, answer)).toHaveLength(1);
    // Each option's shape was read to build the plan, and by nothing after.
    const built = { ...counts };
    expect(built.live).toBeGreaterThan(0);
    expect(built.gone).toBeGreaterThan(0);
    printTimes(watched, answer);
    mapTimes(watched, { state: 'withdrawn', since: '2026-11-09T06:30:00Z' }, (value) => value);
    timePlan(watched);
    expect(counts).toEqual(built);
    // The plan is the schema's own, so a union nested in another schema is read when that is.
    const parent = z.object({ inner: watched });
    expect(timePlan(parent).paths).toEqual(['inner.at', 'inner.since']);
  });
});

describe('social is printed like the rest', () => {
  it('has an output it can read, the story read included (its answer is a choice of two shapes)', () => {
    const story = calls.find(([name]) => name === 'social.stories.get')?.[1] as Call;
    expect(timePlan(outputOf(story))).toEqual({
      paths: ['createdAt', 'latestAt', 'updates[].reportedAt'],
      unknown: [],
    });
  });

  it('is in the lists of calls whose answers are printed, each with its own example answer', () => {
    const social = PRINTING.filter(isSocial);
    expect(social.length).toBeGreaterThan(30);
    expect(Object.keys(EXAMPLE_ANSWERS).filter(isSocial).sort()).toEqual([...social].sort());
    // Named members, so the list can't shrink to nothing or lose the calls an agent depends on.
    expect(social).toEqual(
      expect.arrayContaining([
        'social.me.checkin',
        'social.me.checkinDone',
        'social.stories.get',
        'social.board',
        'owner.keys.list',
        'admin.social.invites.create',
      ]),
    );
  });

  it('fills, in the examples that leave a time null, exactly the times the call can answer and the example does not hold', () => {
    for (const [name, paths] of Object.entries(FILLED)) {
      const call = calls.find(([called]) => called === name)?.[1] as Call;
      const held = HELD[name] ?? [];
      expect([...timePlan(outputOf(call)).paths].sort(), name).toEqual([...paths, ...held].sort());
      const example = callExamples[name]?.output;
      expect(
        timesIn(outputOf(call), example)
          .map((time) => time.path)
          .sort(),
        `${name}'s own example holds only its own times`,
      ).toEqual([...held].sort());
    }
  });

  it('keeps the check-in’s `asOf` and the `seenUntil` it is sent back as the same moment, so a cut can only show the last millisecond again', async () => {
    // The one time of social's an agent sends back: `asOf` of the check-in is `seenUntil` of its
    // `checkinDone`. The printer cuts to the millisecond and never rounds, so the printed value is
    // never later than the database's (which refuses a `seenUntil` after its clock and only moves
    // its mark forward), and the items kept after the mark (`saved_at > mark`) are those of the
    // last millisecond at most, shown again, never skipped.
    const checkinDone = calls.find(([name]) => name === 'social.me.checkinDone')?.[1] as Call;
    const sent = callExamples['social.me.checkin']?.output as { asOf: string };
    const back = callExamples['social.me.checkinDone']?.input as { seenUntil: string };
    expect(back.seenUntil).toBe(sent.asOf);

    for (const stored of [
      '2026-11-18T08:05:00Z',
      '2026-11-18T08:05:00.123456Z',
      '2026-11-18T08:05:00.999999Z',
      '2026-12-31T23:59:59.999999Z',
      '2026-11-18T08:05:00.000001Z',
    ]) {
      const printed = printedTime(stored);
      expect(printed).toMatch(PRINTED_TIME);
      // Both to the nanosecond, in one format, so the text's order is the time's: the printed time is the
      // stored one's own first digits (a carry into the next second or year would change them), so it
      // is never later, and earlier by less than a millisecond.
      const [head = '', fraction = ''] = stored.slice(0, -1).split('.');
      const exact = `${head}.${fraction.padEnd(9, '0')}`;
      const cut = printed.slice(0, -1);
      expect(exact.startsWith(cut), stored).toBe(true);
      expect(`${cut}000000` <= exact, stored).toBe(true);
      // The call takes what it printed.
      const input = (await checkinDone['~orpc'].inputSchema?.['~standard'].validate({
        requestId: '2f3a4b5c-6d7e-4f8a-9b0c-1d2e3f4a5b6c',
        seenUntil: printed,
      })) as { issues?: unknown[] };
      expect(input.issues, stored).toBeUndefined();
    }
    // The check can fail: a mark that isn't a time is refused.
    const refused = (await checkinDone['~orpc'].inputSchema?.['~standard'].validate({
      requestId: '2f3a4b5c-6d7e-4f8a-9b0c-1d2e3f4a5b6c',
      seenUntil: 'soon',
    })) as { issues?: unknown[] };
    expect(refused.issues?.length).toBeGreaterThan(0);
  });
});
