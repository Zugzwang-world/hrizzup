import { validate } from '@hrizzup/agreement';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connect, transactions } from './database.ts';
import {
  changed,
  examplesOf,
  type Field,
  type Format,
  fieldsOf,
  get,
  type Item,
  limit,
  newId,
  save,
  set,
  TABLES,
} from './records.ts';

/**
 * One record at a time, the content store refuses what the agreement refuses and takes what it
 * takes: every case here passes or fails validate() and the database alike. The limits are
 * worked out from the definitions, so a limit that changes there is tested here at once.
 */

let db: pg.Client;
const tx = transactions(() => db);
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db?.end();
});
beforeEach(() => tx.begin());
afterEach(() => tx.rollback());

const [story] = examplesOf('story/1') as [Item];
const update = examplesOf('update/1').find(
  (u) => u.state === 'live' && u.sources && !u.based_on,
) as Item;
const take = examplesOf('sourced/1').find((s) => s.kind === 'take' && s.state === 'live') as Item;
const ourImage = examplesOf('creation/1').find(
  (c) => c.kind === 'image' && (c.author as Item).kind === 'hrizzup',
) as Item;
const creatorImage = examplesOf('creation/1').find(
  (c) => c.kind === 'image' && (c.author as Item).kind === 'creator',
) as Item;
const creatorPost = examplesOf('creation/1').find(
  (c) => (c.author as Item).kind === 'creator',
) as Item;
const video = examplesOf('creation/1').find((c) => c.kind === 'video') as Item;
const cp = (...points: number[]) => String.fromCodePoint(...points);

/** Records with each field filled in somewhere: the examples, plus a few the examples lack. */
const bases: Item[] = [
  ...examplesOf('story/1'),
  changed(story, (s) => {
    s.state = 'withdrawn';
    s.withdrawn_reason = 'Our AI found that the readings were misreported.';
  }),
  ...examplesOf('update/1'),
  ...examplesOf('sourced/1'),
  ...examplesOf('creation/1'),
  changed(examplesOf('creation/1').find((c) => c.based_on) as Item, (c) => {
    c.locations = ['india'];
  }),
];
const baseFor = (format: Format, field: Field) =>
  bases.find((b) => b.format === format && get(b, field.path) !== undefined);

/** Valid items for a list field, worked out from what its items are. */
function itemsFor(field: Field, count: number): unknown[] {
  const refs = field.layers.flatMap((l) => {
    const items = l.schema.items as { $ref?: string } | undefined;
    return items?.$ref ? [items.$ref] : [];
  });
  const ref = refs[0] ?? '';
  if (ref.endsWith('/location'))
    return ['global', 'india', 'mumbai', 'delhi-ncr', 'bengaluru'].slice(0, count);
  if (ref.endsWith('/category'))
    return ['crypto', 'finance', 'business', 'ai', 'sports'].slice(0, count);
  if (ref.endsWith('/record_id')) return Array.from({ length: count }, () => newId());
  if (ref.endsWith('/web_address'))
    return Array.from({ length: count }, (_, i) => `https://example.com/sources/item-${i}`);
  throw new Error(`No items for ${field.column}`);
}

type Case = { name: string; record: Item; ok: boolean };

/** Each limit's edge, on both sides, for every field that has one. */
function edges(): Case[] {
  const cases: Case[] = [];
  for (const format of Object.keys(TABLES) as Format[]) {
    for (const field of fieldsOf(format)) {
      const name = `${format} ${field.path.join('.')}`;
      const base = baseFor(format, field);
      const types = field.layers.map((l) => l.schema.type);
      const maxLength = limit(field, 'maxLength');
      const plain = field.layers.some((l) =>
        /#\/\$defs\/(one_line|text)$/.test(String(l.schema.$ref)),
      );
      if (plain && maxLength !== undefined && base) {
        cases.push({
          name: `${name} at its longest`,
          record: changed(base, (r) => set(r, field.path, 'x'.repeat(maxLength))),
          ok: true,
        });
        cases.push({
          name: `${name} one character too long`,
          record: changed(base, (r) => set(r, field.path, 'x'.repeat(maxLength + 1))),
          ok: false,
        });
        cases.push({
          name: `${name} empty`,
          record: changed(base, (r) => set(r, field.path, '')),
          ok: false,
        });
      }
      if ((types.includes('integer') || types.includes('number')) && base) {
        const maximum = limit(field, 'maximum');
        const minimum = limit(field, 'minimum');
        const above = limit(field, 'exclusiveMinimum');
        if (maximum !== undefined) {
          cases.push({
            name: `${name} at its largest`,
            record: changed(base, (r) => set(r, field.path, maximum)),
            ok: true,
          });
          cases.push({
            name: `${name} over its largest`,
            record: changed(base, (r) => set(r, field.path, maximum + 1)),
            ok: false,
          });
        }
        if (minimum !== undefined) {
          cases.push({
            name: `${name} at its smallest`,
            record: changed(base, (r) => set(r, field.path, minimum)),
            ok: true,
          });
          cases.push({
            name: `${name} under its smallest`,
            record: changed(base, (r) => set(r, field.path, minimum - 1)),
            ok: false,
          });
        }
        if (above !== undefined) {
          cases.push({
            name: `${name} just over its floor`,
            record: changed(base, (r) => set(r, field.path, above + 0.5)),
            ok: true,
          });
          cases.push({
            name: `${name} at its floor`,
            record: changed(base, (r) => set(r, field.path, above)),
            ok: false,
          });
        }
      }
      if (types.includes('array')) {
        const most = limit(field, 'maxItems') as number;
        const host =
          base ?? bases.find((b) => b.format === format && (format !== 'creation/1' || b.based_on));
        if (!host) throw new Error(`No record to try ${name} on`);
        cases.push({
          name: `${name} with its most items`,
          record: changed(host, (r) => set(r, field.path, itemsFor(field, most))),
          ok: true,
        });
        cases.push({
          name: `${name} with one item too many`,
          record: changed(host, (r) => set(r, field.path, itemsFor(field, most + 1))),
          ok: false,
        });
        cases.push({
          name: `${name} empty`,
          record: changed(host, (r) => set(r, field.path, [])),
          ok: false,
        });
        const [one] = itemsFor(field, 1);
        cases.push({
          name: `${name} with an item twice`,
          record: changed(host, (r) => set(r, field.path, [one, one])),
          ok: false,
        });
      }
    }
  }
  return cases;
}

/**
 * Saves a record on its own and gives back the database's refusal, or null: only the rules every
 * statement checks, since what it names (its story, its author) isn't there. The rules across
 * records are in across-records.test.ts.
 */
const attemptSave = (record: Item) => tx.attempt(() => save(db, record), { atCommit: false });

describe('the content store, one record at a time', () => {
  it.each(edges())('$name: the agreement and the database agree', async ({ record, ok }) => {
    expect(validate(record).length === 0, 'validate()').toBe(ok);
    const error = await attemptSave(record);
    if (ok) expect(error).toBeNull();
    else {
      expect(error, 'the database refused it').not.toBeNull();
      expect(error?.code, error?.message).toBe('23514');
    }
  });

  // Each refused by validate() and by the database, which names the rule it broke.
  it.each([
    [
      'a hidden zero-width character',
      changed(story, (s) => (s.title = `Breaking${cp(0x200b)} news`)),
      ['one_line_pattern'],
    ],
    [
      'a hidden tag character',
      changed(story, (s) => (s.summary = `Smog.${cp(0xe0049, 0xe0047, 0xe004e)}`)),
      ['plain_text_code_checks'],
    ],
    [
      'a line break in a one-line field',
      changed(story, (s) => (s.title = 'Breaking\nnews')),
      ['one_line_pattern'],
    ],
    [
      'a new line at the end of a one-line field',
      changed(story, (s) => (s.title = 'Smog\n')),
      ['one_line_pattern', 'one_line_code_checks'],
    ],
    [
      'a new line at the end of a text',
      changed(story, (s) => (s.summary = `${String(s.summary)}\n`)),
      ['plain_text_pattern', 'plain_text_code_checks'],
    ],
    [
      'a soft hyphen',
      changed(story, (s) => (s.title = `Smog${cp(0xad)}gy Delhi`)),
      ['one_line_pattern'],
    ],
    [
      'an Arabic letter mark',
      changed(story, (s) => (s.title = `Delhi${cp(0x61c)} smog`)),
      ['one_line_pattern'],
    ],
    [
      'a Hangul filler',
      changed(story, (s) => (s.title = `${cp(0x3164)} Delhi smog`)),
      ['one_line_pattern'],
    ],
    [
      'stacked variation selectors',
      changed(story, (s) => (s.summary = `Smog ${cp(0x2764, 0xfe0f, 0xfe0f)}`)),
      ['plain_text_code_checks'],
    ],
    [
      'an extra variation selector',
      changed(story, (s) => (s.summary = `Smog ${cp(0x2764, 0xe0100)}`)),
      ['plain_text_code_checks'],
    ],
    [
      'a private-use character beyond the first plane',
      changed(story, (s) => (s.title = `Delhi ${cp(0xf0000)} smog`)),
      ['one_line_code_checks'],
    ],
    [
      'a musical format character',
      changed(story, (s) => (s.title = `Delhi ${cp(0x1d173)} smog`)),
      ['one_line_code_checks'],
    ],
    [
      'a joiner between plain letters',
      changed(story, (s) => (s.summary = `Del${cp(0x200d)}hi`)),
      ['plain_text_code_checks'],
    ],
    [
      'a joiner at the start',
      changed(story, (s) => (s.summary = `${cp(0x200d, 0x1f4bb)} late`)),
      ['plain_text_pattern', 'plain_text_code_checks'],
    ],
    [
      'two joiners in a row',
      changed(story, (s) => (s.summary = `Late ${cp(0x1f468, 0x200d, 0x200d, 0x1f4bb)}`)),
      ['plain_text_code_checks'],
    ],
    [
      'four categories',
      changed(story, (s) => (s.categories = ['ai', 'business', 'finance', 'crypto'])),
      ['stories_categories_list'],
    ],
    [
      'the same location twice',
      changed(story, (s) => (s.locations = ['mumbai', 'mumbai'])),
      ['stories_locations_list'],
    ],
    [
      'an ID that is not a version 7 UUID',
      changed(story, (s) => (s.id = 'c56a4180-65aa-42ec-a945-5fd21dec0538')),
      ['record_id_version_7'],
    ],
    [
      'the nil UUID as an ID',
      changed(story, (s) => (s.id = '00000000-0000-0000-0000-000000000000')),
      ['record_id_version_7'],
    ],
    [
      'a state the agreement has no place for',
      changed(story, (s) => (s.state = 'draft')),
      ['stories_state_values'],
    ],
    [
      'a merged story that names no story',
      changed(story, (s) => (s.state = 'merged')),
      ['stories_merged_into_only_when_merged'],
    ],
    [
      'a live story that names where it went',
      changed(story, (s) => (s.merged_into = examplesOf('story/1')[2]?.id)),
      ['stories_merged_into_only_when_merged'],
    ],
    [
      'a withdrawn story without its reason',
      changed(story, (s) => (s.state = 'withdrawn')),
      ['stories_withdrawn_reason_only_when_withdrawn'],
    ],
    ['a time that never ends', changed(story, (s) => (s.updated_at = 'infinity')), ['time_range']],
    [
      'a time after the year 9999',
      changed(story, (s) => (s.updated_at = '10000-01-01T00:00:00Z')),
      ['time_range'],
    ],
    [
      'an update with no source',
      changed(update, (u) => {
        delete u.sources;
        delete u.based_on;
      }),
      ['updates_names_what_it_is_based_on'],
    ],
    [
      'a post on X among the other sources',
      changed(
        update,
        (u) => (u.sources = ['https://x.com/example_news/status/9900000000000000101']),
      ),
      ['source_address_not_on_x'],
    ],
    [
      "a post on X at Twitter's old address",
      changed(
        update,
        (u) => (u.sources = ['https://mobile.twitter.com/example_news/status/9900000000000000101']),
      ),
      ['source_address_not_on_x'],
    ],
    [
      "a link through X's own shortener",
      changed(update, (u) => (u.sources = ['https://t.co/x1y2z3'])),
      ['source_address_not_on_x'],
    ],
    [
      "a picture on X's media server",
      changed(update, (u) => (u.sources = ['https://pbs.twimg.com/media/example.jpg'])),
      ['source_address_not_on_x'],
    ],
    [
      'a name hidden before the host',
      changed(update, (u) => (u.sources = ['https://news@x.com/example_news/status/1'])),
      ['web_address_pattern'],
    ],
    [
      'a host ending in a dot',
      changed(update, (u) => (u.sources = ['https://x.com./example_news/status/1'])),
      ['web_address_pattern', 'source_address_not_on_x'],
    ],
    [
      'a host written in percent codes',
      changed(update, (u) => (u.sources = ['https://x%2Ecom/example_news/status/1'])),
      ['web_address_pattern'],
    ],
    [
      'a host in full-width letters',
      changed(
        update,
        (u) => (u.sources = [`https://${cp(0xff58, 0xff0e, 0xff43, 0xff4f, 0xff4d)}/a`]),
      ),
      ['web_address_pattern', 'web_address_characters'],
    ],
    [
      'a backslash, which browsers read as a slash',
      changed(update, (u) => (u.sources = ['https://x.com\\example_news/status/1'])),
      ['web_address_pattern', 'web_address_characters'],
    ],
    [
      'a plain http address',
      changed(update, (u) => (u.sources = ['http://example.com/sources/notice'])),
      ['web_address_pattern'],
    ],
    // A link shown to readers holds no hidden, direction or non-ASCII look-alike character: a web address
    // keeps to the characters its standard allows, as validate()'s format "uri" does.
    ...(
      [
        ['a zero-width space in a source', cp(0x200b)],
        ['a direction override in a source', cp(0x202e)],
        ['a byte-order mark in a source', cp(0xfeff)],
        ['a hidden tag character in a source', cp(0xe0049)],
        ['a joiner in a source', cp(0x200d)],
        ['a letter outside plain ASCII in a source', cp(0xe9)],
        ['a look-alike Cyrillic letter in a source', cp(0x430)],
        ['a percent sign before letters that are not hexadecimal', '%zz'],
        ['a percent sign at the end of a source', '%'],
      ] as const
    ).map(([name, text]): [string, Item, string[]] => [
      name,
      changed(update, (u) => (u.sources = [`https://example.com/sources/notice${text}`])),
      ['web_address_characters'],
    ]),
    [
      'a repeated update that names no update',
      changed(update, (u) => (u.state = 'merged')),
      ['updates_merged_into_only_when_merged'],
    ],
    [
      'a withdrawn update without its reason',
      changed(update, (u) => (u.state = 'withdrawn')),
      ['updates_withdrawn_reason_only_when_withdrawn'],
    ],
    [
      'a sourced item that says it was made',
      changed(take, (s) => (s.route = 'made')),
      ['sourced_items_route_values'],
    ],
    [
      'a post address that is not on X',
      changed(
        take,
        (s) => ((s.post as Item).url = 'https://example.com/status/9900000000000000102'),
      ),
      ['x_post_url_pattern'],
    ],
    [
      'a handle written with its @',
      changed(take, (s) => ((s.post as Item).handle = '@example')),
      ['x_handle_pattern'],
    ],
    [
      "a post's address in the handle-free form Grok cites",
      changed(take, (s) => ((s.post as Item).url = 'https://x.com/i/status/9900000000000000102')),
      ['x_post_url_not_handle_free'],
    ],
    [
      'a withdrawn take without its reason',
      changed(take, (s) => (s.state = 'withdrawn')),
      ['sourced_items_withdrawn_reason_only_when_withdrawn'],
    ],
    [
      'a take that names no story',
      changed(take, (s) => delete s.story_ids),
      ['sourced_items_take_names_a_story'],
    ],
    [
      'a live item without its post',
      changed(take, (s) => delete s.post),
      ['sourced_items_keeps_its_post_while_available'],
    ],
    [
      'a live item without our summary',
      changed(take, (s) => delete s.summary),
      ['sourced_items_keeps_its_post_while_available'],
    ],
    [
      'an item gone from X that still holds the post',
      changed(take, (s) => (s.state = 'unavailable')),
      ['sourced_items_unavailable_keeps_nothing_of_the_post'],
    ],
    [
      'an item gone from X that still holds our summary',
      changed(take, (s) => {
        s.state = 'unavailable';
        delete s.post;
      }),
      ['sourced_items_unavailable_keeps_nothing_of_the_post'],
    ],
    [
      'a kind of post the agreement has no place for',
      changed(take, (s) => ((s.post as Item).media = 'audio')),
      ['sourced_items_post_media_values'],
    ],
    [
      'a user posting an image',
      changed(creatorImage, (c) => ((c.author as Item).kind = 'user')),
      ['creations_users_post_text'],
    ],
    [
      'an image without words for people who cannot see it',
      changed(ourImage, (c) => delete (c.image as Item).alt),
      ['creations_image_only_for_an_image'],
    ],
    [
      'an image with a full web address instead of its file',
      changed(ourImage, (c) => ((c.image as Item).key = 'https://example.com/a.webp')),
      ['media_key_pattern'],
    ],
    [
      'a post by Hrizzup with no story and no category',
      changed(ourImage, (c) => delete c.story_ids),
      ['creations_ours_and_creators_name_a_story_or_category'],
    ],
    [
      'our own post marked as posted',
      changed(ourImage, (c) => (c.route = 'posted')),
      ['creations_route_follows_the_author'],
    ],
    [
      "a creator's post marked as made",
      changed(creatorPost, (c) => (c.route = 'made')),
      ['creations_route_follows_the_author'],
    ],
    [
      'a post that claims it was found',
      changed(ourImage, (c) => (c.route = 'found')),
      ['creations_route_follows_the_author'],
    ],
    [
      "a creator's post that claims to build on found posts",
      changed(creatorPost, (c) => (c.based_on = [take.id])),
      ['creations_based_on_only_for_made'],
    ],
    [
      'a text post with no words',
      changed(creatorPost, (c) => delete c.text),
      ['creations_text_has_words'],
    ],
    [
      'a text post carrying an image',
      changed(creatorPost, (c) => (c.image = structuredClone(ourImage.image))),
      ['creations_image_only_for_an_image'],
    ],
    [
      'a video post without its video',
      changed(video, (c) => delete c.video),
      ['creations_video_only_for_a_video'],
    ],
    [
      'a video ID in capitals',
      changed(video, (c) => ((c.video as Item).stream_id = 'D009FF720C4A97A4E68AD5C695F538E8')),
      ['stream_id_pattern'],
    ],
    [
      'a placeholder that is too short',
      changed(ourImage, (c) => ((c.image as Item).placeholder = '1QcSHQRnh493V4d')),
      ['placeholder_length'],
    ],
  ] as [string, Item, string[]][])('refuses %s', async (_, record, rules) => {
    expect(validate(record), 'validate()').not.toEqual([]);
    const error = await attemptSave(record);
    expect(error, 'the database refused it').not.toBeNull();
    expect(rules, error?.message).toContain(error?.constraint);
  });

  it.each([
    ['a location not in the shared list', changed(story, (s) => (s.locations = ['pune']))],
    ['a category not in the shared list', changed(story, (s) => (s.categories = ['weather']))],
  ])('refuses %s: the list holds only its codes', async (_, record) => {
    expect(validate(record), 'validate()').not.toEqual([]);
    const error = await attemptSave(record);
    expect(error?.code, error?.message).toBe('22P02');
    expect(error?.message).toMatch(/invalid input value for enum agreement\.(location|category)/);
  });

  it.each([
    ['a time that does not exist', changed(story, (s) => (s.created_at = '2026-13-45T25:61:61Z'))],
    [
      'half of a broken surrogate pair',
      changed(story, (s) => (s.title = `Delhi ${cp(0xd800)} smog`)),
    ],
  ])('refuses %s: the database cannot even hold it', async (_, record) => {
    expect(validate(record), 'validate()').not.toEqual([]);
    expect(await attemptSave(record), 'the database refused it').not.toBeNull();
  });

  it.each([
    ['an emoji built with a zero-width joiner', `Coding late ${cp(0x1f468, 0x200d, 0x1f4bb)}`],
    ['a symbol in its text style', `Smile ${cp(0x263a, 0xfe0e)} please`],
    ['an emoji with its variation selector', `We love it ${cp(0x2764, 0xfe0f)}`],
    ['a keycap emoji', `Number ${cp(0x31, 0xfe0f, 0x20e3)} again`],
    ['a flag built with a joiner', `Pride ${cp(0x1f3f3, 0xfe0f, 0x200d, 0x1f308)}`],
    ['a word in Devanagari', `${cp(0x928, 0x92e, 0x938, 0x94d, 0x924, 0x947)} Mumbai`],
    ['typographic quotes and dashes', `India${cp(0x2019)}s chase ${cp(0x2014)} 289 for 6`],
    ['several lines', 'First line.\nSecond line.\n\nA third, after a blank line.'],
  ])('takes %s in a text', async (_, text) => {
    const record = changed(story, (s) => (s.summary = text));
    expect(validate(record)).toEqual([]);
    expect(await attemptSave(record)).toBeNull();
  });

  it.each([
    ['a page whose address only mentions X', 'https://example.com/how-x.com-works?via=twitter.com'],
    ['a site whose name ends like X', 'https://www.example-x.com/news/delhi-smog'],
    ['a site whose name starts with t', 'https://t.com.example.org/notice'],
    ['an international name in its xn-- form', 'https://xn--h1alffa9f.xn--p1ai/news?id=7#top'],
    ['a page on a numbered port', 'https://example.com:8443/sources/notice'],
    ['an accented letter in percent codes', 'https://example.com/sources/caf%C3%A9'],
    ['the marks a web address uses', "https://example.com/a/b-c_d.e~f;g=h,i?j=k&l='m'(n)*+!$:@#o"],
  ])('takes, as a source, %s', async (_, address) => {
    const record = changed(update, (u) => (u.sources = [address]));
    expect(validate(record)).toEqual([]);
    expect(await attemptSave(record)).toBeNull();
  });

  it.each([
    ['a withdrawn story with its reason', bases[examplesOf('story/1').length] as Item],
    ['a post with a location', bases.at(-1) as Item],
    ['an ID in a new record', changed(story, (s) => (s.id = newId()))],
  ])('takes %s', async (_, record) => {
    expect(validate(record)).toEqual([]);
    expect(await attemptSave(record)).toBeNull();
  });
});
