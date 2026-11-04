import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Format, parts, shapes } from './definitions.ts';
import { readmePath, renderReadme } from './readme.ts';
import { validate, validator } from './validate.ts';

/**
 * The agreement's check (agreement/README.md, "The check"), run on every pull request inside
 * Quick checks: every example passes its definition, every definition has examples, the
 * definitions work in any language, and the README says exactly what the definitions say.
 */

type Item = { [key: string]: unknown };
type Example = { file: string; record: Item };

const examplesDir = fileURLToPath(new URL('../examples/', import.meta.url));
const examples: Example[] = readdirSync(examplesDir)
  .filter((f) => f.endsWith('.json'))
  .flatMap((file) =>
    (JSON.parse(readFileSync(`${examplesDir}${file}`, 'utf8')) as Item[]).map((record) => ({
      file,
      record,
    })),
  );
const of = (format: Format) =>
  examples.filter((e) => e.record.format === format).map((e) => e.record);
const stories = of('story/1');
const updates = of('update/1');
const creations = of('creation/1');
const markets = of('market/1');
const readings = of('reading/1');
const definitions = [...parts, ...Object.values(shapes)] as Item[];

/** Visits every schema object, optionally skipping the rule keywords (if/then, allOf…). */
function walk(node: unknown, visit: (node: Item) => void, fieldsOnly = false) {
  if (typeof node !== 'object' || node === null) return;
  if (!Array.isArray(node)) visit(node as Item);
  for (const [key, value] of Object.entries(node)) {
    if (fieldsOnly && RULES.has(key)) continue;
    walk(value, visit, fieldsOnly);
  }
}
const RULES = new Set(['allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else', 'contains']);

describe('the definitions', () => {
  it('are valid JSON Schema 2020-12 and load in strict mode, with every reference found', () => {
    for (const schema of Object.values(shapes))
      expect(validator().getSchema(schema.$id)).toBeTypeOf('function');
  });

  it('use only regular-expression features that every language reads the same way', () => {
    // \d, \w, \s and \b mean different things in Python and JavaScript; \p{…}, look-behinds,
    // look-aheads and named groups aren't supported everywhere. Characters are spelt out instead,
    // as four-digit \u escapes: the form JSON Schema's standard (ECMA-262) uses.
    const unportable = /\\(?:[dDwWsSbBpPkxc1-9]|u(?![0-9a-f]{4}))|\(\?<|\(\?[=!]/;
    walk(definitions, (node) => {
      if (typeof node.pattern !== 'string') return;
      expect(node.pattern, node.pattern).not.toMatch(unportable);
      expect(() => new RegExp(node.pattern as string, 'u')).not.toThrow();
      expect(() => new RegExp(node.pattern as string)).not.toThrow();
    });
  });

  it('explain every field, so the README can say what each one means', () => {
    walk(
      definitions,
      (node) => {
        for (const [name, field] of Object.entries(
          (node.properties ?? {}) as Record<string, Item>,
        )) {
          expect(typeof field.description, `the field ${name} needs a description`).toBe('string');
        }
      },
      true,
    );
  });

  it('each have examples', () => {
    for (const format of Object.keys(shapes) as Format[])
      expect(of(format).length, format).toBeGreaterThan(0);
  });
});

describe('the examples', () => {
  it('each pass their definition', () => {
    for (const { file, record } of examples) {
      expect(validate(record), `${file}: ${String(record.id)}`).toEqual([]);
    }
  });

  it('have IDs that are never reused', () => {
    const ids = examples.map((e) => e.record.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only refer to examples that exist', () => {
    const storyIds = new Set(stories.map((s) => s.id));
    const updatesById = new Map(updates.map((u) => [u.id, u]));
    for (const s of stories.filter((s) => s.merged_into)) {
      expect(storyIds.has(s.merged_into)).toBe(true);
      expect(s.merged_into).not.toBe(s.id);
    }
    for (const u of updates) {
      expect(storyIds.has(u.story_id), String(u.id)).toBe(true);
      if (!u.corrects) continue;
      const corrected = updatesById.get(u.corrects);
      expect(corrected?.story_id, 'a correction stays in its story').toBe(u.story_id);
      expect(String(corrected?.reported_at) < String(u.reported_at)).toBe(true);
    }
    for (const c of creations) {
      for (const id of (c.story_ids as string[] | undefined) ?? [])
        expect(storyIds.has(id)).toBe(true);
    }
    for (const m of markets.filter((m) => m.match_ref)) {
      expect(readings.some((r) => (r.match as Item | undefined)?.ref === m.match_ref)).toBe(true);
    }
  });

  it('settle markets only to outcomes they offer', () => {
    for (const m of markets) {
      const outcomes = ((m.outcomes as Item[] | undefined) ?? []).map((o) => o.code);
      expect(new Set(outcomes).size, 'outcome codes are unique').toBe(outcomes.length);
      if (m.result === undefined) continue;
      expect(m.kind === 'yes_no' ? ['yes', 'no'] : outcomes).toContain(m.result);
    }
  });

  it('keep the hard cases', () => {
    const live = (id: unknown) =>
      updates.filter((u) => u.story_id === id && u.state === 'live').length;
    expect(
      stories.some((s) => live(s.id) >= 20),
      'a story with many updates',
    ).toBe(true);
    expect(
      stories.some((s) => live(s.id) >= 3 && live(s.id) < 20),
      'a story with several updates',
    ).toBe(true);
    expect(
      stories.some((s) => String(s.title).length === 120),
      'a title at the longest allowed',
    ).toBe(true);
    for (const kind of ['text', 'image', 'video']) {
      expect(
        creations.some((c) => c.kind === kind),
        `a creation of kind ${kind}`,
      ).toBe(true);
    }
    const pictured = new Set(
      creations.filter((c) => c.kind !== 'text').flatMap((c) => c.story_ids as string[]),
    );
    expect(
      stories.some((s) => s.state === 'live' && !pictured.has(String(s.id))),
      'a story with no image',
    ).toBe(true);
    expect(
      creations.some((c) =>
        String((c.image as Item | undefined)?.key).startsWith('examples/missing/'),
      ),
      'an image whose file is missing',
    ).toBe(true);
    expect(
      stories.some((s) => s.state === 'merged'),
      'a merged story',
    ).toBe(true);
    expect(
      updates.some((u) => u.state === 'withdrawn'),
      'a withdrawn update',
    ).toBe(true);
    expect(
      updates.some((u) => u.corrects),
      'a correction',
    ).toBe(true);
  });
});

describe('the format check', () => {
  const story = stories[0] as Item;
  const creation = creations.find((c) => c.kind === 'image') as Item;
  const market = markets.find((m) => m.kind === 'yes_no') as Item;
  const reading = readings.find((r) => r.subject === 'bitcoin') as Item;
  const cp = (...points: number[]) => String.fromCodePoint(...points);
  const changed = (record: Item, change: (copy: Item) => void) => {
    const copy = structuredClone(record);
    change(copy);
    return copy;
  };

  it.each([
    ['a field the agreement does not define', changed(story, (s) => (s.priority = 'top'))],
    ['a missing required field', changed(story, (s) => delete s.title)],
    ['a title one character too long', changed(story, (s) => (s.title = 'x'.repeat(121)))],
    [
      'a hidden zero-width character',
      changed(story, (s) => (s.title = `Breaking${String.fromCodePoint(0x200b)} news`)),
    ],
    [
      'a hidden tag character',
      changed(story, (s) => (s.summary = `Smog.\u{E0049}\u{E0047}\u{E004E}`)),
    ],
    ['a line break in a one-line field', changed(story, (s) => (s.title = 'Breaking\nnews'))],
    ['a soft hyphen', changed(story, (s) => (s.title = `Smog${cp(0xad)}gy Delhi`))],
    ['an Arabic letter mark', changed(story, (s) => (s.title = `Delhi${cp(0x61c)} smog`))],
    ['a Hangul filler', changed(story, (s) => (s.title = `${cp(0x3164)} Delhi smog`))],
    ['a zero-width non-joiner', changed(story, (s) => (s.title = `Del${cp(0x200c)}hi smog`))],
    [
      'stacked variation selectors',
      changed(story, (s) => (s.summary = `Smog ${cp(0x2764, 0xfe0f, 0xfe0f)}`)),
    ],
    [
      'an extra variation selector',
      changed(story, (s) => (s.summary = `Smog ${cp(0x2764, 0xe0100)}`)),
    ],
    ['a joiner between plain letters', changed(story, (s) => (s.summary = `Del${cp(0x200d)}hi`))],
    [
      'two joiners in a row',
      changed(story, (s) => (s.summary = `Late ${cp(0x1f468, 0x200d, 0x200d, 0x1f4bb)}`)),
    ],
    ['a location not in the shared list', changed(story, (s) => (s.locations = ['pune']))],
    [
      'four categories',
      changed(story, (s) => (s.categories = ['ai', 'business', 'finance', 'crypto'])),
    ],
    ['the same category twice', changed(story, (s) => (s.categories = ['ai', 'ai']))],
    [
      'a time that is not in UTC',
      changed(story, (s) => (s.created_at = '2026-11-02T07:10:00+05:30')),
    ],
    [
      'an ID that is not a version 7 UUID',
      changed(story, (s) => (s.id = 'c56a4180-65aa-42ec-a945-5fd21dec0538')),
    ],
    ['an unknown format version', changed(story, (s) => (s.format = 'story/2'))],
    ['a merged story that names no story', changed(story, (s) => (s.state = 'merged'))],
    ['a user posting an image', changed(creation, (c) => ((c.author as Item).kind = 'user'))],
    [
      'an image without words for people who cannot see it',
      changed(creation, (c) => delete (c.image as Item).alt),
    ],
    [
      'an image with a full web address instead of its file',
      changed(creation, (c) => ((c.image as Item).key = 'https://example.com/a.webp')),
    ],
    [
      'a post by Hrizzup with no story and no category',
      changed(creation, (c) => delete c.story_ids),
    ],
    [
      'a yes-or-no market with outcomes',
      changed(
        market,
        (m) =>
          (m.outcomes = [
            { code: 'a', label: 'A', reading_value: 'A' },
            { code: 'b', label: 'B', reading_value: 'B' },
          ]),
      ),
    ],
    ['a price market without its threshold', changed(market, (m) => delete m.threshold)],
    [
      'a settled market without its result',
      changed(market, (m) => {
        m.state = 'settled';
        m.settled_at = m.closes_at;
      }),
    ],
    [
      'a price reading that holds a ranking',
      changed(reading, (r) => (r.ranking = { leaders: [{ rank: 1, name: 'X' }] })),
    ],
    [
      'a price written as a number, not text',
      changed(reading, (r) => ((r.price as Item).amount = 101245.37)),
    ],
  ])('refuses %s', (_, record) => {
    expect(validate(record)).not.toEqual([]);
  });

  it.each([
    ['an emoji built with a zero-width joiner', `Coding late ${cp(0x1f468, 0x200d, 0x1f4bb)}`],
    ['an emoji with its variation selector', `We love it ${cp(0x2764, 0xfe0f)}`],
    ['a keycap emoji', `Number ${cp(0x31, 0xfe0f, 0x20e3)} again`],
    ['a flag built with a joiner', `Pride ${cp(0x1f3f3, 0xfe0f, 0x200d, 0x1f308)}`],
    ['a word in Devanagari', `${cp(0x928, 0x92e, 0x938, 0x94d, 0x924, 0x947)} Mumbai`],
    ['typographic quotes and dashes', `India${cp(0x2019)}s chase ${cp(0x2014)} 289 for 6`],
  ])('accepts %s', (_, text) => {
    expect(validate(changed(story, (s) => (s.summary = text)))).toEqual([]);
  });
});

describe('the README', () => {
  it('says exactly what the definitions, lists and examples say', () => {
    const readme = readFileSync(readmePath, 'utf8');
    expect(renderReadme(readme) === readme, 'run: pnpm --filter @hrizzup/agreement readme').toBe(
      true,
    );
  });
});
