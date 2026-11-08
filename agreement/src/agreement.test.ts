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
const sourced = of('sourced/1');
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
    const storiesById = new Map(stories.map((s) => [s.id, s]));
    const updatesById = new Map(updates.map((u) => [u.id, u]));
    const sourcedIds = new Set(sourced.map((s) => s.id));
    for (const s of stories.filter((s) => s.merged_into)) {
      expect(storyIds.has(s.merged_into)).toBe(true);
      expect(s.merged_into).not.toBe(s.id);
      expect(storiesById.get(s.merged_into)?.state, 'a merge is never a chain').not.toBe('merged');
    }
    for (const u of updates) {
      expect(storyIds.has(u.story_id), String(u.id)).toBe(true);
      expect(
        storiesById.get(u.story_id)?.state,
        "a merge moves the duplicate's updates to the story that stays",
      ).not.toBe('merged');
      for (const id of (u.based_on as string[] | undefined) ?? [])
        expect(sourcedIds.has(id), 'an update reports posts our bots found').toBe(true);
      if (u.merged_into) {
        const kept = updatesById.get(u.merged_into);
        expect(kept?.story_id, 'a repeat names an update in its own story').toBe(u.story_id);
        expect(kept?.state, 'a repeat names an update that is shown').toBe('live');
      }
      if (!u.corrects) continue;
      const corrected = updatesById.get(u.corrects);
      expect(corrected?.story_id, 'a correction stays in its story').toBe(u.story_id);
      expect(corrected?.state, 'a correction names an update that is shown').toBe('live');
      expect(String(corrected?.reported_at) < String(u.reported_at)).toBe(true);
    }
    for (const s of sourced) {
      for (const id of (s.story_ids as string[] | undefined) ?? []) {
        expect(storyIds.has(id), String(s.id)).toBe(true);
        expect(storiesById.get(id)?.state, 'a merge moves sourced items too').not.toBe('merged');
      }
    }
    for (const c of creations) {
      for (const id of (c.story_ids as string[] | undefined) ?? [])
        expect(storyIds.has(id)).toBe(true);
      for (const id of (c.based_on as string[] | undefined) ?? [])
        expect(sourcedIds.has(id), 'our own content builds on a sourced item').toBe(true);
    }
    for (const m of markets.filter((m) => m.match_ref)) {
      expect(readings.some((r) => (r.match as Item | undefined)?.ref === m.match_ref)).toBe(true);
    }
  });

  it('never point at a real post on X, and keep each post once', () => {
    // X numbers its posts with signed 64-bit integers, so a larger number can't be a real post:
    // an example embedded on a preview can never show a stranger's post. An unavailable item
    // holds no post at all (its definition refuses one), so there's nothing of it to check.
    const largest = 2n ** 63n - 1n;
    const numbers = sourced
      .filter((s) => s.post)
      .map((s) => {
        const post = s.post as Item;
        const [, handle = '', number = '0'] =
          /^https:\/\/x\.com\/([A-Za-z0-9_]+)\/status\/([0-9]+)$/.exec(String(post.url)) ?? [];
        expect(handle, 'the address names the handle').toBe(post.handle);
        expect(handle.startsWith('example'), `${handle} is an example handle`).toBe(true);
        expect(BigInt(number) > largest, `${number} can't be a real post`).toBe(true);
        return number;
      });
    expect(new Set(numbers).size, 'each post is kept once').toBe(numbers.length);
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
    // Only our own and creators' posts picture a story; a found post never does (D5).
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
    expect(
      updates.some((u) => u.state === 'merged'),
      'an update that repeats another',
    ).toBe(true);
    expect(
      updates.some((u) => u.based_on && u.sources),
      'an update based on posts our bots found and on other pages',
    ).toBe(true);
    expect(
      updates.some((u) => u.state === 'withdrawn' && u.based_on),
      'a withdrawn update whose posts are gone from X',
    ).toBe(true);
    const feed = [...sourced.filter((s) => s.kind === 'take'), ...creations];
    for (const route of ['found', 'made', 'posted']) {
      expect(
        feed.some((f) => f.route === route),
        `a feed item that was ${route}`,
      ).toBe(true);
    }
    for (const media of ['text', 'image', 'video']) {
      expect(
        sourced.some((s) => s.kind === 'take' && (s.post as Item).media === media),
        `a found take of ${media}`,
      ).toBe(true);
    }
    for (const kind of ['news', 'take']) {
      expect(
        sourced.some((s) => s.kind === kind && s.state === 'unavailable'),
        `a found post of ${kind} that is gone from X`,
      ).toBe(true);
    }
    expect(
      sourced.some((s) => s.kind === 'take' && s.state === 'withdrawn'),
      'a withdrawn take',
    ).toBe(true);
    expect(
      sourced.some((s) => s.kind === 'news' && !s.story_ids),
      'news that no story uses yet',
    ).toBe(true);
    expect(
      sourced.some((s) => !(s.post as Item).name),
      'a found post with no name',
    ).toBe(true);
    expect(
      creations.some((c) => c.based_on),
      'our own content built on a found post',
    ).toBe(true);
  });
});

describe('the format check', () => {
  const story = stories[0] as Item;
  const update = updates.find((u) => u.state === 'live' && u.sources && !u.based_on) as Item;
  const take = sourced.find((s) => s.kind === 'take' && s.state === 'live') as Item;
  const creation = creations.find((c) => c.kind === 'image') as Item;
  const creatorPost = creations.find((c) => (c.author as Item).kind === 'creator') as Item;
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
    ['a private-use character', changed(story, (s) => (s.title = `Delhi ${cp(0xe000)} smog`))],
    [
      'a private-use character beyond the first plane',
      changed(story, (s) => (s.title = `Delhi ${cp(0xf0000)} smog`)),
    ],
    ['an Arabic number sign', changed(story, (s) => (s.title = `Delhi ${cp(0x600)} smog`))],
    ['a musical format character', changed(story, (s) => (s.title = `Delhi ${cp(0x1d173)} smog`))],
    [
      'a hieroglyph format character',
      changed(story, (s) => (s.title = `Delhi ${cp(0x13430)} smog`)),
    ],
    [
      'half of a broken surrogate pair',
      changed(story, (s) => (s.title = `Delhi ${cp(0xd800)} smog`)),
    ],
    [
      'a reserved invisible character not yet assigned',
      changed(story, (s) => (s.title = `Delhi ${cp(0xe0002)} smog`)),
    ],
    [
      'another reserved invisible character',
      changed(story, (s) => (s.title = `Delhi ${cp(0xe0fff)} smog`)),
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
    ['a take that names no story', changed(take, (s) => delete s.story_ids)],
    ['a sourced item that says it was made', changed(take, (s) => (s.route = 'made'))],
    [
      "a copy of the found post's words",
      changed(take, (s) => ((s.post as Item).text = 'The whole post, copied.')),
    ],
    [
      'a post address that is not on X',
      changed(
        take,
        (s) => ((s.post as Item).url = 'https://example.com/status/9900000000000000102'),
      ),
    ],
    ['a handle written with its @', changed(take, (s) => ((s.post as Item).handle = '@example'))],
    ['a withdrawn take without its reason', changed(take, (s) => (s.state = 'withdrawn'))],
    [
      "a post's address in the handle-free form Grok cites",
      changed(take, (s) => ((s.post as Item).url = 'https://x.com/i/status/9900000000000000102')),
    ],
    ['a live item without its post', changed(take, (s) => delete s.post)],
    ['a live item without our summary', changed(take, (s) => delete s.summary)],
    [
      'an item whose post is gone from X that still holds the post',
      changed(take, (s) => (s.state = 'unavailable')),
    ],
    [
      'an item whose post is gone from X that still holds our summary',
      changed(take, (s) => {
        s.state = 'unavailable';
        delete s.post;
      }),
    ],
    [
      'an update with no source',
      changed(update, (u) => {
        delete u.sources;
        delete u.based_on;
      }),
    ],
    [
      'a post on X among the other sources',
      changed(
        update,
        (u) => (u.sources = ['https://x.com/example_news/status/9900000000000000101']),
      ),
    ],
    [
      "a post on X at Twitter's old address",
      changed(
        update,
        (u) => (u.sources = ['https://mobile.twitter.com/example_news/status/9900000000000000101']),
      ),
    ],
    [
      "a link through X's own shortener",
      changed(update, (u) => (u.sources = ['https://t.co/x1y2z3'])),
    ],
    [
      "a picture on X's media server",
      changed(update, (u) => (u.sources = ['https://pbs.twimg.com/media/example.jpg'])),
    ],
    // A web address's host is plain letters, digits, hyphens and dots, so every language reads
    // the same host from it, and none of these can slip a post on X past the rule above.
    [
      'a name hidden before the host',
      changed(update, (u) => (u.sources = ['https://news@x.com/example_news/status/1'])),
    ],
    [
      'a host ending in a dot',
      changed(update, (u) => (u.sources = ['https://x.com./example_news/status/1'])),
    ],
    [
      'a host written in percent codes',
      changed(update, (u) => (u.sources = ['https://x%2Ecom/example_news/status/1'])),
    ],
    [
      'a host in full-width letters',
      changed(
        update,
        (u) => (u.sources = [`https://${cp(0xff58, 0xff0e, 0xff43, 0xff4f, 0xff4d)}/a`]),
      ),
    ],
    [
      'a backslash, which browsers read as a slash',
      changed(update, (u) => (u.sources = ['https://x.com\\example_news/status/1'])),
    ],
    ['a repeated update that names no update', changed(update, (u) => (u.state = 'merged'))],
    [
      'a live update that names one it repeats',
      changed(update, (u) => (u.merged_into = '01a19ae2-d780-7a89-96fb-aeeefeab4196')),
    ],
    ['a post with no route', changed(creation, (c) => delete c.route)],
    ['our own post marked as posted', changed(creation, (c) => (c.route = 'posted'))],
    ["a creator's post marked as made", changed(creatorPost, (c) => (c.route = 'made'))],
    ['a post that claims it was found', changed(creation, (c) => (c.route = 'found'))],
    [
      "a creator's post that claims to build on found posts",
      changed(creatorPost, (c) => (c.based_on = [take.id])),
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
    ['a symbol in its text style', `Smile ${cp(0x263a, 0xfe0e)} please`],
    ['an emoji with its variation selector', `We love it ${cp(0x2764, 0xfe0f)}`],
    ['a keycap emoji', `Number ${cp(0x31, 0xfe0f, 0x20e3)} again`],
    ['a flag built with a joiner', `Pride ${cp(0x1f3f3, 0xfe0f, 0x200d, 0x1f308)}`],
    ['a word in Devanagari', `${cp(0x928, 0x92e, 0x938, 0x94d, 0x924, 0x947)} Mumbai`],
    ['typographic quotes and dashes', `India${cp(0x2019)}s chase ${cp(0x2014)} 289 for 6`],
  ])('accepts %s', (_, text) => {
    expect(validate(changed(story, (s) => (s.summary = text)))).toEqual([]);
  });

  it.each([
    ['a page whose address only mentions X', 'https://example.com/how-x.com-works?via=twitter.com'],
    ['a site whose name ends like X', 'https://www.example-x.com/news/delhi-smog'],
    ['a site whose name starts with t', 'https://t.com.example.org/notice'],
    ['an international name in its xn-- form', 'https://xn--h1alffa9f.xn--p1ai/news?id=7#top'],
    ['a page on a numbered port', 'https://example.com:8443/sources/notice'],
  ])('accepts, as a source, %s', (_, address) => {
    expect(validate(changed(update, (u) => (u.sources = [address])))).toEqual([]);
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
