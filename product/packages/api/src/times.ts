import { shapes } from '@hrizzup/agreement';
import { marketRecord } from './trading.ts';

/**
 * The one printer of the API's times (the API's one output layer, `product/web/lib/api/base.ts`,
 * calls it on every answer): every time the API prints has exactly three decimals, as in
 * `2026-11-09T06:30:00.000Z`, whichever way the database or a package wrote it (`…30Z`, `….3Z`,
 * `….123456Z`). Inputs are not touched: a time you send may have none to six.
 *
 * A time is found by the call's own output schema, never by how a string looks, so free text (a
 * question, a rule, a source's name) never changes even when it reads like a time. The printing is
 * text only, never a `Date`: it pads the fraction to three digits, or cuts it at the third, and
 * never rounds, since rounding could carry a time into the next second, day or year and print a
 * moment later than the one stored (cutting is what `toISOString()` and Postgres's
 * `date_trunc('milliseconds')` do).
 */

/** What every printed time looks like. */
export const PRINTED_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const ANY_TIME = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/;

/**
 * A time with exactly three decimals: the fraction padded with zeros or cut at the third digit.
 * Text that isn't a time in UTC comes back unchanged (it can't happen after validation).
 */
export function printedTime(time: string): string {
  const found = ANY_TIME.exec(time);
  if (!found) return time;
  const [, head, fraction] = found;
  return `${head}.${(fraction ?? '').padEnd(3, '0').slice(0, 3)}Z`;
}

/** Where the times are in a shape: a tree with only the parts that hold one. */
type Node =
  | { kind: 'time' }
  | { kind: 'fields'; fields: readonly (readonly [string, Node])[] }
  | { kind: 'each'; element: Node };

/** What a schema holds: its tree (null when it holds no time), and what couldn't be read. */
type Found = { node: Node | null; paths: string[]; unknown: string[] };

/** What `timePlan` says of a schema: the paths of its times (`markets[].market.opens_at`), and the parts it can't read. */
export type TimePlan = { paths: string[]; unknown: string[] };

type Def = {
  type?: string;
  format?: string;
  offset?: boolean;
  local?: boolean;
  checks?: { _zod?: { def?: { format?: string; offset?: boolean; local?: boolean } } }[];
  shape?: Record<string, Schema>;
  catchall?: Schema;
  element?: Schema;
  innerType?: Schema;
  options?: Schema[];
  valueType?: Schema;
  items?: Schema[];
  rest?: Schema | null;
  left?: Schema;
  right?: Schema;
  in?: Schema;
  out?: Schema;
};
type Schema = { _zod: { def: Def } };

const NOTHING: Found = { node: null, paths: [], unknown: [] };

/** The kinds of schema that wrap another and print as it does. */
const WRAPPERS = new Set([
  'optional',
  'nullable',
  'default',
  'prefault',
  'readonly',
  'nonoptional',
  'catch',
]);

/** The kinds that can't hold a time. */
const LEAVES = new Set([
  'number',
  'int',
  'boolean',
  'bigint',
  'symbol',
  'null',
  'undefined',
  'void',
  'never',
  'enum',
  'literal',
  'date',
  'nan',
]);

const TIME_REF = 'common.schema.json#/$defs/time';

/**
 * The agreement's market record, as `marketRecord` takes it: its times are the top-level
 * properties of the agreement's own definition that refer to its time. A time reference anywhere
 * deeper in the definition is a time this can't reach, so it says so.
 */
const MARKET_RECORD = (() => {
  const definition = shapes['market/1'];
  const properties = (definition as { properties: Record<string, { $ref?: string }> }).properties;
  const times = Object.entries(properties)
    .filter(([, property]) => property.$ref === TIME_REF)
    .map(([key]) => key);
  const all = JSON.stringify(definition).split(`"${TIME_REF}"`).length - 1;
  return { times, deeper: all > times.length };
})();

function join(prefix: string, key: string): string {
  return prefix ? `${prefix}.${key}` : key;
}

/** Whether a string schema is a datetime: by its own format (`z.iso.datetime()`) or by a check (`z.string().datetime()`). */
function datetime(def: Def): { time: boolean; needsConverting: boolean } {
  const formats = [def, ...(def.checks ?? []).map((check) => check._zod?.def ?? {})];
  const found = formats.filter((one) => one.format === 'datetime');
  return {
    time: found.length > 0,
    needsConverting: found.some((one) => one.offset === true || one.local === true),
  };
}

function read(schema: Schema, prefix: string): Found {
  const def = schema._zod.def;
  const type = def.type ?? '';

  if (type === 'string') {
    const { time, needsConverting } = datetime(def);
    if (!time) return NOTHING;
    if (needsConverting) return { node: null, paths: [], unknown: [prefix] };
    return { node: { kind: 'time' }, paths: [prefix], unknown: [] };
  }

  if (LEAVES.has(type)) return NOTHING;

  if (WRAPPERS.has(type) && def.innerType) return read(def.innerType, prefix);

  if (type === 'array' && def.element) {
    const inner = read(def.element, `${prefix}[]`);
    return {
      node: inner.node && { kind: 'each', element: inner.node },
      paths: inner.paths,
      unknown: inner.unknown,
    };
  }

  if (type === 'object' && def.shape) {
    const fields: [string, Node][] = [];
    const paths: string[] = [];
    const unknown: string[] = [];
    for (const [key, field] of Object.entries(def.shape)) {
      const inner = read(field, join(prefix, key));
      if (inner.node) fields.push([key, inner.node]);
      paths.push(...inner.paths);
      unknown.push(...inner.unknown);
    }
    // Whatever a catchall lets through is not read: a catchall that could hold a time says so.
    if (def.catchall && def.catchall._zod.def.type !== 'never') {
      const inner = read(def.catchall, join(prefix, '*'));
      if (inner.node || inner.paths.length > 0 || inner.unknown.length > 0)
        unknown.push(join(prefix, '*'));
    }
    return { node: fields.length > 0 ? { kind: 'fields', fields } : null, paths, unknown };
  }

  if (type === 'custom') {
    if (schema === (marketRecord as unknown as Schema)) {
      const fields = MARKET_RECORD.times.map((key) => [key, { kind: 'time' }] as const);
      return {
        node: { kind: 'fields', fields },
        paths: MARKET_RECORD.times.map((key) => join(prefix, key)),
        unknown: MARKET_RECORD.deeper ? [prefix] : [],
      };
    }
    return { node: null, paths: [], unknown: [prefix] };
  }

  // These hold no time when nothing inside them does; if something does, it isn't read.
  const inside: Schema[] = [];
  if (type === 'union') inside.push(...(def.options ?? []));
  else if (type === 'record' && def.valueType) inside.push(def.valueType);
  else if (type === 'tuple') inside.push(...(def.items ?? []), ...(def.rest ? [def.rest] : []));
  else if (type === 'intersection' && def.left && def.right) inside.push(def.left, def.right);
  else if (type === 'pipe' && def.in && def.out) inside.push(def.in, def.out);
  else return { node: null, paths: [], unknown: [prefix] };
  const holds = inside.some((one) => {
    const inner = read(one, prefix);
    return inner.node || inner.paths.length > 0 || inner.unknown.length > 0;
  });
  return holds ? { node: null, paths: [], unknown: [prefix] } : NOTHING;
}

const plans = new WeakMap<object, Found>();

/** What a schema that can't be read holds: nothing is printed, and it says so. */
const UNREADABLE: Found = { node: null, paths: [], unknown: [''] };

/**
 * A schema's times, compiled once for each schema object. Never throws: anything that isn't a
 * schema, or can't be read, is unreadable (and not kept), so a printer can't turn a call into an error.
 */
function compiled(schema: unknown): Found {
  if (typeof schema !== 'object' || schema === null) return UNREADABLE;
  let found = plans.get(schema);
  if (found) return found;
  try {
    found = read(schema as Schema, '');
  } catch {
    return UNREADABLE;
  }
  plans.set(schema, found);
  return found;
}

/**
 * Where the times are in a schema, by path (`markets[].market.opens_at`), and what it couldn't
 * read (`unknown`: a part whose times, if it has any, aren't printed). The tests make sure
 * `unknown` stays empty for every call.
 */
export function timePlan(schema: unknown): TimePlan {
  const { paths, unknown } = compiled(schema);
  return { paths: [...paths], unknown: [...unknown] };
}

function mapNode(node: Node, value: unknown, fn: (time: string) => string): unknown {
  switch (node.kind) {
    case 'time':
      return typeof value === 'string' ? fn(value) : value;
    case 'each':
      return Array.isArray(value) ? value.map((item) => mapNode(node.element, item, fn)) : value;
    case 'fields': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
      const copy: Record<string, unknown> = { ...value };
      for (const [key, inner] of node.fields) {
        if (Object.hasOwn(copy, key)) copy[key] = mapNode(inner, copy[key], fn);
      }
      return copy;
    }
  }
}

/**
 * The value with `fn` applied to each of the times its schema names. It never throws and never
 * changes the value it is given: what changes is copied once, in the same key order; a part that
 * isn't what the schema says (null, absent, the wrong kind) comes back as it is.
 */
export function mapTimes(schema: unknown, value: unknown, fn: (time: string) => string): unknown {
  const { node } = compiled(schema);
  return node ? mapNode(node, value, fn) : value;
}

/** An answer with every time printed with three decimals. */
export function printTimes<T>(schema: unknown, value: T): T {
  return mapTimes(schema, value, printedTime) as T;
}

function collect(
  node: Node,
  value: unknown,
  path: string,
  into: { path: string; time: string }[],
): void {
  switch (node.kind) {
    case 'time':
      if (typeof value === 'string') into.push({ path, time: value });
      return;
    case 'each':
      if (Array.isArray(value))
        value.forEach((item, index) => {
          collect(node.element, item, `${path}[${index}]`, into);
        });
      return;
    case 'fields': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
      for (const [key, inner] of node.fields) {
        if (Object.hasOwn(value, key))
          collect(inner, (value as Record<string, unknown>)[key], join(path, key), into);
      }
    }
  }
}

/** Every time in a value that its schema names, with its place (`markets[0].market.opens_at`). */
export function timesIn(schema: unknown, value: unknown): { path: string; time: string }[] {
  const { node } = compiled(schema);
  const found: { path: string; time: string }[] = [];
  if (node) collect(node, value, '', found);
  return found;
}

/**
 * The free text in an answer that may read like a time: the perp's log of rule changes holds the
 * old and new value of a rule as the database wrote them (`funding_from` is a time, as text).
 */
export const FREE_TEXT_PATHS: readonly string[] = ['log[].oldValue', 'log[].newValue'];

const READS_LIKE_A_TIME = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/** Where in a value a string reads like a time, by path (`markets[].market.question`). */
function readsLikeATime(value: unknown, path = ''): string[] {
  if (typeof value === 'string') return READS_LIKE_A_TIME.test(value) ? [path] : [];
  if (Array.isArray(value)) return value.flatMap((item) => readsLikeATime(item, `${path}[]`));
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, inner]) => readsLikeATime(inner, join(path, key)));
  }
  return [];
}

/**
 * What is wrong with printing an answer, for the tests that run real answers (the packages' database
 * tests) through the printer: nothing, when
 * - every time the schema names comes out with three decimals and is the one it went in as, cut
 *   (`new Date(time).toISOString()`);
 * - nothing but a time changed;
 * - printing it again changes nothing;
 * - no string the schema doesn't name as a time reads like one, bar the named free text.
 */
export function printingProblems(schema: unknown, answer: unknown): string[] {
  const problems: string[] = [];
  const printed = printTimes(schema, answer);
  const before = timesIn(schema, answer);
  const after = timesIn(schema, printed);
  if (before.length !== after.length) problems.push('the number of times changed');
  for (const [index, { path, time }] of after.entries()) {
    const given = before[index];
    if (!given || given.path !== path) {
      problems.push(`${path}: not where it was`);
    } else if (Number.isNaN(Date.parse(given.time))) {
      problems.push(`${path}: ${given.time} is not a time`);
    } else if (time !== new Date(given.time).toISOString()) {
      problems.push(`${path}: ${given.time} printed as ${time}`);
    }
    if (!PRINTED_TIME.test(time)) problems.push(`${path}: ${time} has not three decimals`);
  }
  const masked = (value: unknown) => JSON.stringify(mapTimes(schema, value, () => ''));
  if (masked(printed) !== masked(answer)) problems.push('something but a time changed');
  if (JSON.stringify(printTimes(schema, printed)) !== JSON.stringify(printed)) {
    problems.push('printing it again changed it');
  }
  const named = new Set(compiled(schema).paths);
  for (const path of readsLikeATime(printed)) {
    if (!named.has(path) && !FREE_TEXT_PATHS.includes(path)) {
      problems.push(`${path}: reads like a time, but the schema doesn't name it`);
    }
  }
  return problems;
}
