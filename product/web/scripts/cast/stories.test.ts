import { validate } from '@hrizzup/agreement';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Harness, harness, idOf, seedMember } from './harness.ts';
import { main } from './main.ts';
import { keyFile } from './members.ts';
import { readState, writeState } from './state.ts';
import {
  checkCommand,
  loadCommand,
  parseSet,
  prepareSet,
  SET_FORMAT,
  type SetFile,
  WITHDRAWN_REASON,
  withdrawCommand,
} from './stories.ts';

/** Test group 7: stories. A set file, its records, loading, loading again, and the withdrawal. */

let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(() => h.cleanup());

const iso = (ms: number) => new Date(ms).toISOString();
const HOUR = 3_600_000;

/** A set of `count` stories of two updates each, written two hours ago. */
function setOf(count: number, options: { updates?: number } = {}): SetFile {
  const written = iso(h.clock.now() - 2 * HOUR);
  return {
    format: SET_FORMAT,
    written,
    stories: Array.from({ length: count }, (_, i) => ({
      story: {
        title: `A test story, number ${i + 1}`,
        summary: `What happens in test story ${i + 1}, in one sentence.`,
        locations: ['india'],
        categories: ['general'],
      },
      updates: Array.from({ length: options.updates ?? 2 }, (_, at) => ({
        headline: `Update ${at + 1} of story ${i + 1}`,
        body: `More detail on update ${at + 1}.`,
        reported_at: iso(h.clock.now() - 5 * HOUR - at * HOUR),
        sources: [`https://example.com/test/${i + 1}/${at + 1}`],
      })),
    })),
  };
}

const counter = () => {
  let n = 500;
  return () => idOf(n++);
};

const write = (name: string, set: unknown) =>
  h.store.writeText(`stories/${name}`, `${JSON.stringify(set, null, 2)}\n`);

describe('a set file', () => {
  it('gets a fresh id for each record without one, once', () => {
    const set = setOf(8);
    const first = prepareSet(set, h.clock.now(), counter());
    expect(first.changed).toBe(true);
    expect(first.problems).toEqual([]);
    const ids = first.file.stories.flatMap((s) => [s.story.id, ...s.updates.map((u) => u.id)]);
    expect(ids.every((id) => typeof id === 'string')).toBe(true);
    expect(new Set(ids).size).toBe(8 * 3);
    const second = prepareSet(first.file, h.clock.now(), counter());
    expect(second.changed).toBe(false);
    expect(second.file).toEqual(first.file);
  });

  it('fills in the id even where the file has an empty or null one, and keeps it on the next read', async () => {
    const set = setOf(8);
    const [first] = set.stories;
    if (!first) throw new Error('no story');
    (first.story as { id?: unknown }).id = '';
    (first.updates[0] as { id?: unknown }).id = null;
    (first.updates[1] as { id?: unknown }).id = '';
    const prepared = prepareSet(set, h.clock.now(), counter());
    expect(prepared.changed).toBe(true);
    expect(prepared.problems).toEqual([]);
    const filled = prepared.file.stories[0];
    expect(filled?.story.id).toMatch(/^01900000-0000-7000-8000-/);
    expect(filled?.updates.map((update) => update.id)).toEqual([
      expect.stringMatching(/^01900000-/),
      expect.stringMatching(/^01900000-/),
    ]);
    // The records carry the same ids the file will hold.
    expect(prepared.records[0]?.story.id).toBe(filled?.story.id);
    expect(prepared.records[0]?.updates.map((record) => record.id)).toEqual(
      filled?.updates.map((update) => update.id),
    );

    // Through the command: the file is written back with the ids, and the next check changes nothing.
    write('empty-ids.json', set);
    checkCommand(h.ctx, 'empty-ids.json');
    const written = JSON.parse(h.store.readText('stories/empty-ids.json') ?? '{}') as SetFile;
    expect(written.stories[0]?.story.id).toMatch(/^01a/);
    expect(written.stories[0]?.updates.every((update) => /^01a/.test(String(update.id)))).toBe(
      true,
    );
    const text = h.store.readText('stories/empty-ids.json');
    checkCommand(h.ctx, 'empty-ids.json');
    expect(h.store.readText('stories/empty-ids.json')).toBe(text);
  });

  it('makes the records as the rule says: the times, the state, and what the agreement checks', () => {
    const set = setOf(8);
    const added = iso(h.clock.now() - 90 * 60_000);
    const [only] = set.stories;
    if (!only) throw new Error('no story');
    (only.updates[1] as { added?: string }).added = added;
    const prepared = prepareSet(set, h.clock.now(), counter());
    expect(prepared.problems).toEqual([]);
    for (const { story, updates } of prepared.records) {
      expect(story.format).toBe('story/1');
      expect(story.state).toBe('live');
      expect(story.created_at).toBe(set.written);
      for (const update of updates) {
        expect(update.format).toBe('update/1');
        expect(update.state).toBe('live');
        expect(update.story_id).toBe(story.id);
        expect(update.created_at).toBe(update.updated_at);
      }
      expect(validate(story)).toEqual([]);
      for (const update of updates) expect(validate(update)).toEqual([]);
    }
    const first = prepared.records[0];
    expect(first?.story.updated_at).toBe(added);
    expect(first?.updates[0]?.created_at).toBe(set.written);
    expect(first?.updates[1]?.created_at).toBe(added);
    expect(first?.updates[1]?.updated_at).toBe(added);
    // A story with nothing added later is as old as the set, in both times.
    expect(prepared.records[1]?.story.updated_at).toBe(set.written);
  });

  it('refuses what the agreement refuses, naming the story and the field', () => {
    const set = setOf(8);
    (set.stories[2]?.story as { categories: string[] }).categories = ['not-a-category'];
    const prepared = prepareSet(set, h.clock.now(), counter());
    expect(prepared.problems.join('\n')).toMatch(/story 3: \/categories/);
  });

  it.each([
    [
      'an unknown field',
      (set: SetFile) => {
        (set.stories[0]?.story as Record<string, unknown>).tags = [];
      },
      /tags is not a field/,
    ],
    [
      'based_on',
      (set: SetFile) => {
        (set.stories[0]?.updates[0] as Record<string, unknown>).based_on = [idOf(1)];
      },
      /based_on is refused/,
    ],
    [
      'fewer than two updates',
      (set: SetFile) => {
        set.stories[0]?.updates.pop();
      },
      /story 1: it needs at least two updates/,
    ],
    [
      'an update with no sources',
      (set: SetFile) => {
        (set.stories[0]?.updates[1] as { sources: string[] }).sources = [];
      },
      /story 1, update 2: it needs at least one source/,
    ],
    [
      'a source on X',
      (set: SetFile) => {
        (set.stories[0]?.updates[1] as { sources: string[] }).sources = [
          'https://x.com/a/status/1',
        ];
      },
      /story 1, update 2/,
    ],
    [
      'a duplicate story id',
      (set: SetFile) => {
        (set.stories[0]?.story as { id?: string }).id = idOf(77);
        (set.stories[1]?.story as { id?: string }).id = idOf(77);
      },
      /used twice/,
    ],
    [
      'a duplicate update id',
      (set: SetFile) => {
        (set.stories[0]?.updates[0] as { id?: string }).id = idOf(78);
        (set.stories[0]?.updates[1] as { id?: string }).id = idOf(78);
      },
      /used twice/,
    ],
    [
      'a time within a minute of now',
      (set: SetFile) => {
        set.written = iso(h.clock.now() - 30_000);
      },
      /less than 60 seconds in the past/,
    ],
    [
      'an update added within a minute of now',
      (set: SetFile) => {
        (set.stories[0]?.updates[0] as { added?: string }).added = iso(h.clock.now() - 10_000);
      },
      /added.*less than 60 seconds/,
    ],
    [
      'a reported_at within a minute of now',
      (set: SetFile) => {
        (set.stories[0]?.updates[0] as { reported_at: string }).reported_at = iso(h.clock.now());
      },
      /reported_at.*less than 60 seconds/,
    ],
    [
      'a time that is not a time',
      (set: SetFile) => {
        (set.stories[0]?.updates[0] as { reported_at: string }).reported_at = 'yesterday';
      },
      /reported_at/,
    ],
  ])('refuses %s', (_what, change, message) => {
    const set = setOf(8);
    change(set);
    const prepared = prepareSet(set, h.clock.now(), counter());
    expect(prepared.problems.join('\n')).toMatch(message);
  });

  it('only warns for fewer than 8 or more than 10 stories, and more than four updates', () => {
    expect(prepareSet(setOf(7), h.clock.now(), counter()).warnings.join()).toMatch(/7 stories/);
    expect(prepareSet(setOf(11), h.clock.now(), counter()).warnings.join()).toMatch(/11 stories/);
    expect(prepareSet(setOf(9), h.clock.now(), counter()).warnings).toEqual([]);
    const many = prepareSet(setOf(8, { updates: 5 }), h.clock.now(), counter());
    expect(many.problems).toEqual([]);
    expect(many.warnings.join()).toMatch(/5 updates/);
  });

  it('is read from JSON of its own format only', () => {
    expect(() => parseSet('not json')).toThrow(/not valid JSON/);
    expect(() =>
      parseSet('{"format":"other","written":"2026-11-19T09:00:00Z","stories":[]}'),
    ).toThrow(/format must be/);
    expect(() => parseSet(`{"format":"${SET_FORMAT}","written":"yesterday","stories":[]}`)).toThrow(
      /written/,
    );
    expect(() =>
      parseSet(
        `{"format":"${SET_FORMAT}","written":"2026-11-19T09:00:00Z","stories":[],"extra":1}`,
      ),
    ).toThrow(/extra is not a field/);
  });
});

describe('stories check', () => {
  it('fills in the ids and writes the file back, offline', async () => {
    write('set.json', setOf(8));
    expect(await main(['stories', 'check', 'set.json'], h.io, () => h.ctx)).toBe(0);
    expect(h.printed()).toContain('ok: 8 stories, 16 updates');
    const back = JSON.parse(h.store.readText('stories/set.json') ?? '{}') as SetFile;
    expect(back.stories.every((s) => typeof s.story.id === 'string')).toBe(true);
    expect(h.server.requests).toEqual([]);
    // Checking again changes nothing.
    const text = h.store.readText('stories/set.json');
    checkCommand(h.ctx, 'set.json');
    expect(h.store.readText('stories/set.json')).toBe(text);
  });

  it('refuses a file with problems (exit 2), after writing the ids it filled in', async () => {
    const set = setOf(8);
    set.stories[0]?.updates.pop();
    write('set.json', set);
    expect(await main(['stories', 'check', 'set.json'], h.io, () => h.ctx)).toBe(2);
    expect(h.printed()).toContain('at least two updates');
  });

  it('takes only files in the stories folder', async () => {
    h.store.writeText('work/set.json', JSON.stringify(setOf(8)));
    expect(await main(['stories', 'check', `${h.home}/work/set.json`], h.io, () => h.ctx)).toBe(2);
    expect(await main(['stories', 'check', '../set.json'], h.io, () => h.ctx)).toBe(2);
  });
});

describe('stories load', () => {
  it('saves each story listed, then its updates oldest first, and answers new for each', async () => {
    write('set.json', setOf(8));
    expect(await main(['stories', 'load', 'set.json'], h.io, () => h.ctx)).toBe(0);
    expect(h.stories.badBodies).toEqual([]);
    expect(h.stories.stories.size).toBe(8);
    expect(h.stories.updates.size).toBe(16);
    for (const { listed } of h.stories.stories.values()) expect(listed).toBe(true);
    const lines = h.printed().split('\n').filter(Boolean);
    expect(lines.filter((line) => line.startsWith('story new:'))).toHaveLength(8);
    expect(lines.filter((line) => line.startsWith('  update new:'))).toHaveLength(16);
    // Each story's updates go oldest first (by reported_at).
    const updateRequests = h.server.to('POST', /\/admin\/social\/updates$/);
    for (let i = 0; i < updateRequests.length; i += 2) {
      const [first, second] = [updateRequests[i], updateRequests[i + 1]].map((req) =>
        Date.parse(String(((req?.body?.record ?? {}) as { reported_at?: string }).reported_at)),
      );
      expect(first).toBeLessThan(second ?? 0);
    }
    const state = readState(h.store);
    expect(state.current?.file).toBe('set.json');
    expect(state.current?.storyIds).toHaveLength(8);
  });

  it('answers same when the file is loaded again, and grows the set when an update or a story is added', async () => {
    const set = setOf(8);
    write('set.json', set);
    await loadCommand(h.ctx, 'set.json');
    h.writes.length = 0;
    await loadCommand(h.ctx, 'set.json');
    const again = h.printed().split('\n').filter(Boolean);
    expect(again.every((line) => /same:/.test(line))).toBe(true);
    expect(h.stories.saves).toHaveLength(8 + 16);

    // An update added to the first story, and a ninth story.
    const loaded = JSON.parse(h.store.readText('stories/set.json') ?? '{}') as SetFile;
    const later = iso(h.clock.now() - 10 * 60_000);
    loaded.stories[0]?.updates.push({
      headline: 'A third update, added later',
      reported_at: later,
      added: later,
      sources: ['https://example.com/test/1/3'],
    });
    loaded.stories.push(setOf(1).stories[0] as SetFile['stories'][number]);
    write('set.json', loaded);
    h.writes.length = 0;
    await loadCommand(h.ctx, 'set.json');
    const grown = h.printed().split('\n').filter(Boolean);
    expect(grown.filter((line) => line.startsWith('story changed:'))).toHaveLength(1);
    expect(grown.filter((line) => line.startsWith('story new:'))).toHaveLength(1);
    expect(grown.filter((line) => line.startsWith('  update new:'))).toHaveLength(1 + 2);
    expect(h.stories.stories.size).toBe(9);
    expect(readState(h.store).current?.storyIds).toHaveLength(9);
    expect(h.stories.badBodies).toEqual([]);
  });

  it('refuses any other file while a set is current, and a file that drops a story of it', async () => {
    write('set.json', setOf(8));
    write('other.json', setOf(8));
    await loadCommand(h.ctx, 'set.json');
    expect(await main(['stories', 'load', 'other.json'], h.io, () => h.ctx)).toBe(2);
    expect(h.printed()).toContain('set.json is the current set');
    expect(h.stories.stories.size).toBe(8);

    const trimmed = JSON.parse(h.store.readText('stories/set.json') ?? '{}') as SetFile;
    trimmed.stories.pop();
    write('set.json', trimmed);
    expect(await main(['stories', 'load', 'set.json'], h.io, () => h.ctx)).toBe(2);
    expect(h.printed()).toContain('never remove them');
  });

  it('writes the ids back before it sends anything, so a stop in the middle can be run again', async () => {
    write('set.json', setOf(8));
    let seenOnFirstSave: SetFile | null = null;
    h.server.onRequest = (req) => {
      if (seenOnFirstSave === null && /admin\/social\/stories$/.test(req.path)) {
        seenOnFirstSave = JSON.parse(h.store.readText('stories/set.json') ?? '{}') as SetFile;
      }
    };
    await loadCommand(h.ctx, 'set.json');
    const ids = (seenOnFirstSave as SetFile | null)?.stories.map((s) => s.story.id) ?? [];
    expect(ids).toHaveLength(8);
    expect(ids.every(Boolean)).toBe(true);
  });

  it('refuses a set with problems before anything is sent', async () => {
    const set = setOf(8);
    set.stories[3]?.updates.pop();
    write('set.json', set);
    expect(await main(['stories', 'load', 'set.json'], h.io, () => h.ctx)).toBe(2);
    expect(h.server.requests).toEqual([]);
    expect(readState(h.store).current).toBeNull();
  });
});

describe('stories withdraw', () => {
  it('unpins every member from the set first, then withdraws each story of the file and only those', async () => {
    write('set.json', setOf(8));
    await loadCommand(h.ctx, 'set.json');
    const ids = [...h.stories.stories.keys()];
    const pinner = seedMember(h, 'explainer');
    const other = seedMember(h, 'analyst');
    h.stories.pins.set(pinner.key, new Set([ids[0] ?? '', ids[1] ?? '', idOf(4242)]));
    h.stories.pins.set(other.key, new Set([ids[2] ?? '']));
    // A story that is not the set's, on staging, is never touched.
    h.stories.stories.set(idOf(9999), { record: { id: idOf(9999), state: 'live' }, listed: true });
    h.server.requests.length = 0;
    h.writes.length = 0;

    await withdrawCommand(h.ctx);

    const order = h.server.requests.map(
      (req) => `${req.method} ${req.path.replace(/[0-9a-f-]{36}/g, '{id}')}`,
    );
    const lastUnpin = order.lastIndexOf('POST /api/v1/social/me/pins/{id}/unpin');
    const firstSave = order.indexOf('POST /api/v1/admin/social/stories');
    expect(lastUnpin).toBeGreaterThan(-1);
    expect(lastUnpin).toBeLessThan(firstSave);
    expect(h.stories.pins.get(pinner.key)).toEqual(new Set([idOf(4242)]));
    expect(h.stories.pins.get(other.key)?.size).toBe(0);

    const saves = h.server.to('POST', /\/admin\/social\/stories$/);
    expect(saves).toHaveLength(8);
    for (const req of saves) {
      const { record, listed } = req.body as { record: Record<string, unknown>; listed: boolean };
      expect(record.state).toBe('withdrawn');
      expect(record.withdrawn_reason).toBe(WITHDRAWN_REASON);
      expect(record.updated_at).toBe(iso(h.clock.now() - 5_000));
      expect(listed).toBe(true);
      expect(ids).toContain(record.id);
      expect(validate(record)).toEqual([]);
    }
    expect(h.stories.stories.get(idOf(9999))?.record.state).toBe('live');
    expect(h.stories.badBodies).toEqual([]);
    expect(readState(h.store).current).toBeNull();
    expect(h.printed()).toContain('story withdrawn (changed)');
  });

  it('refuses with no set, and while a run is open', async () => {
    expect(await main(['stories', 'withdraw'], h.io, () => h.ctx)).toBe(2);
    write('set.json', setOf(8));
    await loadCommand(h.ctx, 'set.json');
    const state = readState(h.store);
    state.runs.push({
      n: 1,
      set: 'set.json',
      open: true,
      startedAt: iso(h.clock.now()),
      endedAt: null,
    });
    writeState(h.store, state);
    expect(await main(['stories', 'withdraw'], h.io, () => h.ctx)).toBe(2);
    expect(h.printed()).toContain('A run is open');
    expect(h.stories.saves.some((line) => line.endsWith('withdrawn'))).toBe(false);
  });

  it('lets a fresh set be loaded afterwards', async () => {
    write('set.json', setOf(8));
    await loadCommand(h.ctx, 'set.json');
    await withdrawCommand(h.ctx);
    write('fresh.json', setOf(8));
    expect(await main(['stories', 'load', 'fresh.json'], h.io, () => h.ctx)).toBe(0);
    expect(readState(h.store).current?.file).toBe('fresh.json');
    expect(h.store.exists(keyFile('hztest_explainer'))).toBe(false);
  });

  it('refuses to load a file name that an earlier, withdrawn set used, and says to write the fresh set under a new name', async () => {
    write('set.json', setOf(8));
    await loadCommand(h.ctx, 'set.json');
    await withdrawCommand(h.ctx);
    expect(readState(h.store).withdrawn).toEqual(['set.json']);
    expect(readState(h.store).current).toBeNull();
    h.server.requests.length = 0;
    h.writes.length = 0;
    // The same file again, whatever it holds now (a fresh set written over the old name).
    write('set.json', setOf(8));
    expect(await main(['stories', 'load', 'set.json'], h.io, () => h.ctx)).toBe(2);
    expect(h.printed()).toContain('write the fresh set under a new file name');
    expect(h.server.requests).toEqual([]);
    expect(readState(h.store).current).toBeNull();
    // A new name is fine, and then the withdrawn one is refused as "the current set is another" as before.
    write('fresh.json', setOf(8));
    expect(await main(['stories', 'load', 'fresh.json'], h.io, () => h.ctx)).toBe(0);
    expect(await main(['stories', 'load', 'set.json'], h.io, () => h.ctx)).toBe(2);
    expect(readState(h.store).withdrawn).toEqual(['set.json']);
  });

  it('knows a withdrawn set from the runs made on it when the store is from before names were kept', async () => {
    write('set.json', setOf(8));
    // A store as the first pass left it: no `withdrawn`, the set gone, a run that was made on it.
    h.store.writeJson('state.json', {
      current: null,
      runs: [
        {
          n: 1,
          set: 'set.json',
          open: false,
          startedAt: iso(h.clock.now()),
          endedAt: iso(h.clock.now()),
        },
      ],
    });
    expect(readState(h.store).withdrawn).toEqual([]);
    expect(await main(['stories', 'load', 'set.json'], h.io, () => h.ctx)).toBe(2);
    expect(h.printed()).toContain('new file name');
    expect(h.server.requests).toEqual([]);
    // The set that is current is still loaded again, as it is meant to be, and its runs do not count against it.
    write('now.json', setOf(8));
    await loadCommand(h.ctx, 'now.json');
    const state = readState(h.store);
    state.runs.push({
      n: 2,
      set: 'now.json',
      open: false,
      startedAt: iso(h.clock.now()),
      endedAt: iso(h.clock.now()),
    });
    writeState(h.store, state);
    expect(await main(['stories', 'load', 'now.json'], h.io, () => h.ctx)).toBe(0);
  });
});
