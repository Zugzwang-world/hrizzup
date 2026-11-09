import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { parts, shapes } from '@hrizzup/agreement';
import type { ClientBase } from 'pg';

/**
 * The agreement's records as the content store's tables hold them: one table per shape, one row
 * per record, one column per field, named as the agreement names it, with a nested object's
 * fields flattened (a sourced item's `post.url` is `post_url`). The mapping is worked out from
 * the definitions themselves (`agreement/definitions/`), so a field added there is mapped the
 * same way, and the tests notice when a table hasn't followed.
 */

export type Item = { [key: string]: unknown };
type Schema = { [key: string]: unknown };

/** The shapes the content store holds, by the `format` their records carry. */
export const TABLES = {
  'story/1': 'stories',
  'update/1': 'updates',
  'sourced/1': 'sourced_items',
  'creation/1': 'creations',
} as const;
export type Format = keyof typeof TABLES;
export const isStored = (format: unknown): format is Format =>
  typeof format === 'string' && Object.hasOwn(TABLES, format);

/** The agreement's other shapes, each held by the store its own step builds. */
export const HELD_ELSEWHERE: Record<string, string> = {
  'market/1': 'the markets (PLAN.md step 1.7c)',
};

/** Every definition by its file name, the way `$ref`s name them. */
export const files = new Map<string, Schema>(
  [...parts, ...Object.values(shapes)].map((s) => [fileOf(s as Schema), s as Schema]),
);
function fileOf(schema: Schema): string {
  return String(schema.$id).split('/').pop() as string;
}
export const fileOfFormat = (format: Format) => fileOf(shapes[format] as Schema);

/** A schema found at a `$ref`: the file it's in and its JSON pointer there. */
export type Located = { schema: Schema; file: string; pointer: string };

export function follow(ref: string, from: string): Located {
  const [target = '', pointer = ''] = ref.split('#');
  const file = target || from;
  let node: unknown = files.get(file);
  for (const key of pointer.split('/').filter(Boolean)) node = (node as Schema | undefined)?.[key];
  if (typeof node !== 'object' || node === null)
    throw new Error(`Can't follow ${ref} from ${file}`);
  return { schema: node as Schema, file, pointer };
}

/** A field's own schema, then each schema its `$ref`s lead to, nearest first. */
export function layersOf(at: Located): Located[] {
  const out = [at];
  let next = at;
  while (typeof next.schema.$ref === 'string') {
    next = follow(next.schema.$ref, next.file);
    out.push(next);
  }
  return out;
}

export type Field = {
  /** Where it sits in a record, such as ['post', 'url']. */
  path: string[];
  /** The column that holds it, such as 'post_url'. */
  column: string;
  layers: Located[];
};

const fieldCache = new Map<Format, Field[]>();

/** Every field of a shape but `format`, which names the table, with nested objects' fields. */
export function fieldsOf(format: Format): Field[] {
  const cached = fieldCache.get(format);
  if (cached) return cached;
  const fields: Field[] = [];
  const visit = (at: Located, prefix: string[]) => {
    const properties = at.schema.properties as Record<string, Schema>;
    for (const [name, schema] of Object.entries(properties)) {
      if (prefix.length === 0 && name === 'format') continue;
      const layers = layersOf({
        schema,
        file: at.file,
        pointer: `${at.pointer}/properties/${name}`,
      });
      const object = layers.find((l) => l.schema.type === 'object');
      if (object) visit(object, [...prefix, name]);
      else fields.push({ path: [...prefix, name], column: [...prefix, name].join('_'), layers });
    }
  };
  visit({ schema: shapes[format] as Schema, file: fileOfFormat(format), pointer: '' }, []);
  fieldCache.set(format, fields);
  return fields;
}

/** The rule a field's layers set for one keyword: the tightest, where several set it. */
export function limit(field: Field, keyword: string): number | undefined {
  const values = field.layers
    .map((l) => l.schema[keyword])
    .filter((v): v is number => typeof v === 'number');
  if (values.length === 0) return undefined;
  return keyword.startsWith('max') ? Math.min(...values) : Math.max(...values);
}

export const isTime = (field: Field) => field.layers.some((l) => l.schema.format === 'date-time');

export function get(record: Item, path: string[]): unknown {
  let value: unknown = record;
  for (const key of path) value = (value as Item | undefined)?.[key];
  return value;
}

export function set(record: Item, path: string[], value: unknown): void {
  let at = record;
  for (const key of path.slice(0, -1)) {
    at[key] ??= {};
    at = at[key] as Item;
  }
  const last = path.at(-1) as string;
  if (value === undefined) delete at[last];
  else at[last] = value;
}

/** A record as its table's row: one value per column. */
export function toRow(record: Item): Item {
  const row: Item = {};
  for (const field of fieldsOf(record.format as Format)) {
    const value = get(record, field.path);
    if (value !== undefined) row[field.column] = value;
  }
  return row;
}

/**
 * A row read back as its record. Times come back in UTC from a session set to UTC (`+00:00`),
 * which the agreement writes as `Z`; an empty column is a field left out.
 */
export function toRecord(format: Format, row: Item): Item {
  const record: Item = { format };
  for (const field of fieldsOf(format)) {
    const value = row[field.column];
    if (value === null || value === undefined) continue;
    set(record, field.path, isTime(field) ? utc(value) : value);
  }
  return record;
}

function utc(value: unknown): string {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?)\+00:00$/.exec(String(value));
  if (!match) throw new Error(`Not a time in UTC: ${String(value)}`);
  return `${match[1]}Z`;
}

/** Writes a record into its table. */
export async function save(db: ClientBase, record: Item): Promise<void> {
  const table = TABLES[record.format as Format];
  if (!table) throw new Error(`The content store holds no ${String(record.format)}`);
  await db.query(
    `insert into content.${table} select * from jsonb_populate_record(null::content.${table}, $1)`,
    [toRow(record)],
  );
}

/** Reads a record back from its table, or undefined. */
export async function read(db: ClientBase, format: Format, id: string): Promise<Item | undefined> {
  const { rows } = await db.query<{ row: Item }>(
    `select to_jsonb(t) as row from content.${TABLES[format]} as t where t.id = $1`,
    [id],
  );
  return rows[0] && toRecord(format, rows[0].row);
}

const require = createRequire(import.meta.url);
const examplesDir = dirname(require.resolve('@hrizzup/agreement/examples/stories.json'));

/** Every example in `agreement/examples/`, in file order. */
export const examples: Item[] = readdirSync(examplesDir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .flatMap((f) => JSON.parse(readFileSync(join(examplesDir, f), 'utf8')) as Item[]);

export const examplesOf = (format: Format) => examples.filter((e) => e.format === format);

/** The accounts the example creations were posted from. */
export const accounts = [
  ...new Set(examplesOf('creation/1').map((c) => String((c.author as Item).account_id))),
];

/** Makes the accounts a creation can be posted from, as our sign-in service would. */
export async function makeAccounts(db: ClientBase, ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    await db.query(
      `insert into auth.users (id, aud, role, email) values ($1, 'authenticated', 'authenticated', $2)
       on conflict (id) do nothing`,
      [id, `${id}@example.com`],
    );
  }
}

/** Loads every example the content store holds, with the accounts their posts came from. */
export async function loadExamples(db: ClientBase): Promise<void> {
  await makeAccounts(db, accounts);
  for (const example of examples) if (isStored(example.format)) await save(db, example);
}

/** A new record ID: a version 7 UUID, as the agreement asks. */
export function newId(): string {
  const hex = [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const time = Date.now().toString(16).padStart(12, '0');
  const variant = ((Number.parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${time.slice(0, 8)}-${time.slice(8, 12)}-7${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** A copy of a record with one change made to it. */
export function changed(record: Item, change: (copy: Item) => void): Item {
  const copy = structuredClone(record);
  change(copy);
  return copy;
}
