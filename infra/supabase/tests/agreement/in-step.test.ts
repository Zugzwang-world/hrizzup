import { validate } from '@hrizzup/agreement';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect } from './database.ts';
import {
  examplesOf,
  type Format,
  fieldsOf,
  fileOfFormat,
  files,
  follow,
  type Item,
  type Located,
  TABLES,
} from './records.ts';

/**
 * The database can't read the agreement's files, so its lists' codes, the patterns, the value
 * lists and the code checks on plain text are written out in the migrations. These tests fail the
 * moment any of them differs from `agreement/definitions/` (or from `validate()`, for the checks
 * the agreement makes in code), naming what to change.
 */

type Schema = { [key: string]: unknown };

let db: pg.Client;
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db?.end();
});

/** Every schema the stored shapes rest on, with where it is, following `$ref`s once each. */
function reachable(): Located[] {
  const seen = new Map<string, Located>();
  const visit = (at: Located) => {
    const key = `${at.file}#${at.pointer}`;
    if (seen.has(key)) return;
    seen.set(key, at);
    for (const [name, value] of Object.entries(at.schema)) {
      if (name === '$ref' && typeof value === 'string') visit(follow(value, at.file));
      else if (Array.isArray(value)) {
        value.forEach((v, i) => {
          if (typeof v === 'object' && v !== null)
            visit({ schema: v as Schema, file: at.file, pointer: `${at.pointer}/${name}/${i}` });
        });
      } else if (typeof value === 'object' && value !== null) {
        visit({ schema: value as Schema, file: at.file, pointer: `${at.pointer}/${name}` });
      }
    }
  };
  for (const format of Object.keys(TABLES) as Format[]) {
    visit({
      schema: files.get(fileOfFormat(format)) as Schema,
      file: fileOfFormat(format),
      pointer: '',
    });
  }
  return [...seen.values()];
}

/** The codes of a shared list, in the agreement's order. */
function codes(list: Located): string[] {
  const { schema, file } = list;
  if (typeof schema.const === 'string') return [schema.const];
  if (typeof schema.$ref === 'string') return codes(follow(schema.$ref, file));
  const options = (schema.oneOf ?? schema.anyOf) as Schema[] | undefined;
  if (!options) throw new Error(`${file}#${list.pointer} isn't a list`);
  return options.flatMap((o, i) => codes({ schema: o, file, pointer: `${list.pointer}/${i}` }));
}

describe("the database's lists", () => {
  it('are the shared lists the shapes use, each with exactly the agreement codes, in order', async () => {
    const used = new Set(
      reachable()
        .map((l) => l.schema.$ref)
        .filter((r): r is string => typeof r === 'string')
        .map((r) => /^lists\.schema\.json#\/\$defs\/([a-z_]+)$/.exec(r)?.[1])
        .filter((name): name is string => name !== undefined),
    );
    const { rows } = await db.query<{ list: string; codes: string[] }>(
      `select t.typname as list, array_agg(e.enumlabel::text order by e.enumsortorder) as codes
       from pg_type t join pg_enum e on e.enumtypid = t.oid
       where t.typnamespace = 'agreement'::regnamespace
       group by t.typname`,
    );
    expect(rows.map((r) => r.list).sort(), 'a type in schema agreement for each list').toEqual(
      [...used].sort(),
    );
    for (const { list, codes: inDatabase } of rows) {
      const agreed = codes(follow(`lists.schema.json#/$defs/${list}`, 'lists.schema.json'));
      expect(inDatabase, `agreement.${list}`).toEqual(agreed);
    }
  });
});

/**
 * Where the database's building blocks hold the agreement's patterns, by constraint: `~` must
 * match, `!~` must not. Every pattern the stored shapes use is held by one of these, or by a type
 * that holds its rule another way (HELD_BY_TYPE). A building block's other patterns hold a rule
 * the definitions name without a pattern (BY_FORMAT), proven against validate() below.
 */
const PATTERNS: Record<string, ['~' | '!~', string][]> = {
  'agreement.one_line one_line_pattern': [['~', 'common.schema.json#/$defs/one_line']],
  'agreement.plain_text plain_text_pattern': [['~', 'common.schema.json#/$defs/text']],
  'agreement.web_address web_address_pattern': [['~', 'common.schema.json#/$defs/web_address']],
  'agreement.media_key media_key_pattern': [['~', 'common.schema.json#/$defs/media_key']],
  'agreement.placeholder placeholder_pattern': [['~', 'common.schema.json#/$defs/placeholder']],
  'agreement.stream_id stream_id_pattern': [
    ['~', 'common.schema.json#/$defs/video/properties/stream_id'],
  ],
  'content.x_post_url x_post_url_pattern': [
    ['~', 'sourced.v1.schema.json#/properties/post/properties/url'],
  ],
  'content.x_post_url x_post_url_not_handle_free': [
    ['!~', 'sourced.v1.schema.json#/properties/post/properties/url/not'],
  ],
  'content.x_handle x_handle_pattern': [
    ['~', 'sourced.v1.schema.json#/properties/post/properties/handle'],
  ],
  'content.source_address source_address_not_on_x': [
    ['!~', 'update.v1.schema.json#/properties/sources/items/not'],
  ],
};
const BY_FORMAT: Record<string, string> = {
  'agreement.web_address web_address_characters':
    'the characters a web address can hold under format "uri" (RFC 3986)',
};
const HELD_BY_TYPE: Record<string, string> = {
  'common.schema.json#/$defs/record_id': 'agreement.record_id, a UUID checked for version 7',
  'common.schema.json#/$defs/account_id': 'uuid, an account of our sign-in service',
  'common.schema.json#/$defs/time': 'agreement.time, a moment read back in UTC',
};

describe("the database's patterns", () => {
  it("are the agreement's, character for character", async () => {
    const { rows } = await db.query<{ owner: string; definition: string }>(
      `select format('%s.%s %s', n.nspname, t.typname, c.conname) as owner,
              pg_get_constraintdef(c.oid) as definition
       from pg_constraint c
       join pg_type t on t.oid = c.contypid
       join pg_namespace n on n.oid = t.typnamespace
       where n.nspname in ('agreement', 'content')`,
    );
    const held = new Map<string, ['~' | '!~', string][]>();
    for (const { owner, definition } of rows) {
      for (const [, op, literal] of definition.matchAll(
        /\(?VALUE\)?(?:::text)? (~|!~) '((?:[^']|'')*)'::text/g,
      )) {
        const list = held.get(owner) ?? [];
        list.push([op as '~' | '!~', (literal as string).replaceAll("''", "'")]);
        held.set(owner, list);
      }
    }
    expect([...held.keys()].sort(), 'the constraints that hold patterns').toEqual(
      [...Object.keys(PATTERNS), ...Object.keys(BY_FORMAT)].sort(),
    );
    for (const [owner, expected] of Object.entries(PATTERNS)) {
      const agreed = expected.map(([op, ref]) => {
        const pattern = follow(ref, ref.split('#')[0] as string).schema.pattern;
        expect(typeof pattern, ref).toBe('string');
        return [op, pattern];
      });
      expect(held.get(owner), owner).toEqual(agreed);
    }
  });

  it('cover every pattern the stored shapes use', () => {
    const covered = new Set([
      ...Object.values(PATTERNS).flatMap((list) => list.map(([, ref]) => ref)),
      ...Object.keys(HELD_BY_TYPE),
    ]);
    const used = reachable()
      .filter((l) => typeof l.schema.pattern === 'string')
      .map((l) => `${l.file}#${l.pointer}`);
    expect(used.filter((ref) => !covered.has(ref))).toEqual([]);
  });
});

describe("the database's value lists", () => {
  it("are each field's values in the agreement", async () => {
    const { rows } = await db.query<{ name: string; definition: string }>(
      `select c.conname as name, pg_get_constraintdef(c.oid) as definition
       from pg_constraint c
       where c.connamespace = 'content'::regnamespace and c.contype = 'c' and c.conname like '%\\_values'`,
    );
    const inDatabase = new Map(
      rows.map(({ name, definition }) => [
        name,
        [...definition.matchAll(/'([^']*)'::/g)].map((m) => m[1] as string).sort(),
      ]),
    );
    const agreed = new Map<string, string[]>();
    for (const [format, table] of Object.entries(TABLES)) {
      for (const field of fieldsOf(format as Format)) {
        const own = field.layers[0]?.schema as Schema;
        const values = Array.isArray(own.enum)
          ? own.enum
          : own.const === undefined
            ? []
            : [own.const];
        if (values.length > 0)
          agreed.set(`${table}_${field.column}_values`, values.map(String).sort());
      }
    }
    expect(Object.fromEntries(inDatabase)).toEqual(Object.fromEntries(agreed));
  });
});

describe("the database's checks on characters", () => {
  // validate()'s verdict and the database's, for every character there is, set between two
  // letters in a one-line field (a story's title), in a text (its summary) and in a web address
  // (an update's source). Halves of a surrogate pair are left out: the database can't hold them
  // at all, and validate() refuses them.
  it('refuse exactly the characters validate() refuses', { timeout: 180_000 }, async () => {
    const story = structuredClone(examplesOf('story/1')[0] as Item);
    const update = structuredClone(
      examplesOf('update/1').find((u) => u.state === 'live' && u.sources && !u.based_on) as Item,
    );
    const address = (text: string) => `https://example.com/sources/${text}`;
    const refused = { title: [] as number[], summary: [] as number[], source: [] as number[] };
    for (let cp = 1; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const text = `a${String.fromCodePoint(cp)}a`;
      story.title = text;
      story.summary = text;
      const problems = validate(story);
      if (problems.some((p) => p.path === '/title')) refused.title.push(cp);
      if (problems.some((p) => p.path === '/summary')) refused.summary.push(cp);
      update.sources = [address(text)];
      if (validate(update).length > 0) refused.source.push(cp);
    }
    const { rows } = await db.query<{
      one_line: number[];
      plain_text: number[];
      source: number[];
    }>(
      `select
         coalesce(array_agg(cp order by cp) filter (where not pg_input_is_valid('a' || chr(cp) || 'a', 'agreement.one_line')), '{}') as one_line,
         coalesce(array_agg(cp order by cp) filter (where not pg_input_is_valid('a' || chr(cp) || 'a', 'agreement.plain_text')), '{}') as plain_text,
         coalesce(array_agg(cp order by cp) filter (where not pg_input_is_valid($1 || 'a' || chr(cp) || 'a', 'content.source_address')), '{}') as source
       from generate_series(1, 1114111) as cp
       where cp not between 55296 and 57343`,
      [address('')],
    );
    const differ = (a: number[], b: number[]) => {
      const inB = new Set(b);
      const inA = new Set(a);
      const hex = (n: number) => `U+${n.toString(16).toUpperCase().padStart(4, '0')}`;
      return {
        onlyValidate: a.filter((n) => !inB.has(n)).map(hex),
        onlyDatabase: b.filter((n) => !inA.has(n)).map(hex),
      };
    };
    const same = { onlyValidate: [], onlyDatabase: [] };
    expect(differ(refused.title, rows[0]?.one_line ?? []), 'one line').toEqual(same);
    expect(differ(refused.summary, rows[0]?.plain_text ?? []), 'text').toEqual(same);
    expect(differ(refused.source, rows[0]?.source ?? []), 'a web address').toEqual(same);
    // Not empty either way: every hidden character is among them.
    for (const list of Object.values(refused)) expect(list).toContain(0x200b);
  });
});
