import { readFileSync } from 'node:fs';
import { transaction } from '@hrizzup/db';
import { describe, expect, it } from 'vitest';
import {
  type RunTransaction,
  type SaveTransaction,
  type StoryTarget,
  saveStory,
  saveUpdate,
  type UpdateTarget,
} from './save.ts';

type Item = Record<string, unknown>;
const examples = (file: string): Item[] =>
  JSON.parse(
    readFileSync(new URL(`../../../../agreement/examples/${file}`, import.meta.url), 'utf8'),
  );
const story = (): Item => structuredClone(examples('stories.json')[0] as Item);
const update = (): Item => structuredClone(examples('updates.json')[0] as Item);

/** A database error as `pg` raises it: a code and, for the content store's rules, the rule's name. */
const failure = (code: string, over: Item = {}) =>
  Object.assign(new Error(`The database refused it (${code})`), { code, ...over });

/** A fake transaction: it records every statement, answers what it is given and can fail at the statement or at commit. */
function fake(answer: unknown, options: { atStatement?: Error; atCommit?: Error } = {}) {
  const calls = { runs: 0, statements: [] as { text: string; values: unknown[] }[], committed: 0 };
  const tx: SaveTransaction = {
    async query(text, values) {
      calls.statements.push({ text, values });
      if (options.atStatement) throw options.atStatement;
      return { rows: [{ answer }] };
    },
  };
  const run: RunTransaction = async (work) => {
    calls.runs++;
    const result = await work(tx);
    if (options.atCommit) throw options.atCommit; // a deferred rule, raised when the transaction commits
    calls.committed++;
    return result;
  };
  return { run, calls };
}

const ID = '01a199e9-d180-75ec-8a81-134dd403419a';
const NEW = { id: ID, saved: 'new' };

describe('an invalid record never reaches the database', () => {
  const never = () => fake(NEW);

  it('is turned back with each problem and its path, before any transaction starts', async () => {
    const broken = story();
    broken.title = '';
    broken.categories = [];
    delete broken.created_at;
    const { run, calls } = never();
    const result = await saveStory(broken, { run, fn: 'intake.save_story' });
    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
    const problems = (result as { problems: { path: string; message: string }[] }).problems;
    expect(problems.length).toBeGreaterThanOrEqual(3);
    for (const problem of problems) {
      expect(problem.path).toBeTypeOf('string');
      expect(problem.message).toBeTypeOf('string');
    }
    expect(problems.map((p) => p.path)).toEqual(expect.arrayContaining(['/title']));
    expect(calls.runs).toBe(0);
    expect(calls.statements).toHaveLength(0);
  });

  it('refuses a story with a field the agreement does not have, and one that hides characters', async () => {
    const { run, calls } = never();
    for (const bad of [
      { ...story(), color: 'red' },
      { ...story(), title: `Hidden${String.fromCharCode(0x200b)}word` },
      { ...story(), id: 'not-a-uuid' },
      { ...story(), state: 'merged' }, // merged but names nothing
    ]) {
      const result = await saveStory(bad, { run, fn: 'social.admin_save_story', listed: false });
      expect(result, JSON.stringify(bad).slice(0, 60)).toMatchObject({
        ok: false,
        reason: 'invalid',
      });
    }
    expect(calls.runs).toBe(0);
  });

  it('refuses an update that is no update, and each of its problems', async () => {
    const { run, calls } = never();
    const broken = update();
    broken.headline = 'x'.repeat(500);
    broken.sources = [];
    broken.based_on = [];
    const result = await saveUpdate(broken, { run, fn: 'intake.save_update' });
    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
    expect(calls.runs).toBe(0);
  });

  it('refuses what is not a record at all, and a record of the other kind', async () => {
    const { run, calls } = never();
    for (const record of [null, undefined, 'story', 42, [], {}, { format: 'story/2' }]) {
      expect(await saveStory(record, { run, fn: 'intake.save_story' })).toMatchObject({
        ok: false,
        reason: 'invalid',
      });
      expect(await saveUpdate(record, { run, fn: 'intake.save_update' })).toMatchObject({
        ok: false,
        reason: 'invalid',
      });
    }
    // A good update is not a story, and a good story is not an update.
    const wrongStory = await saveStory(update(), { run, fn: 'intake.save_story' });
    expect(wrongStory).toEqual({
      ok: false,
      reason: 'invalid',
      problems: [{ path: '/format', message: 'must be story/1' }],
    });
    const wrongUpdate = await saveUpdate(story(), { run, fn: 'intake.save_update' });
    expect(wrongUpdate).toEqual({
      ok: false,
      reason: 'invalid',
      problems: [{ path: '/format', message: 'must be update/1' }],
    });
    expect(calls.runs).toBe(0);
  });

  it('refuses a function it does not know, since the name becomes SQL, and a console story with no choice of `listed`', async () => {
    const { run, calls } = never();
    await expect(
      saveStory(story(), { run, fn: 'intake.save_story; drop table content.stories' } as never),
    ).rejects.toThrow(TypeError);
    await expect(saveStory(story(), { run, fn: 'intake.save_update' } as never)).rejects.toThrow(
      TypeError,
    );
    await expect(saveUpdate(update(), { run, fn: 'intake.save_story' } as never)).rejects.toThrow(
      TypeError,
    );
    await expect(
      saveStory(story(), { run, fn: 'social.admin_save_story' } as never),
    ).rejects.toThrow(TypeError);
    await expect(
      saveStory(story(), { run, fn: 'social.admin_save_story', listed: 'yes' } as never),
    ).rejects.toThrow(/listed/);
    expect(calls.runs).toBe(0);
  });
});

describe('a valid record calls the database once', () => {
  const cases: {
    name: string;
    save: (run: RunTransaction) => Promise<unknown>;
    sql: string;
    values: (record: Item) => unknown[];
    record: () => Item;
  }[] = [
    {
      name: 'a story, by the pipeline',
      record: story,
      save: (run) => saveStory(story(), { run, fn: 'intake.save_story' }),
      sql: 'select intake.save_story($1::jsonb) as answer',
      values: (r) => [JSON.stringify(r)],
    },
    {
      name: 'a story, by the console',
      record: story,
      save: (run) => saveStory(story(), { run, fn: 'social.admin_save_story', listed: false }),
      sql: 'select social.admin_save_story($1::jsonb, $2::boolean) as answer',
      values: (r) => [JSON.stringify(r), false],
    },
    {
      name: 'an update, by the pipeline',
      record: update,
      save: (run) => saveUpdate(update(), { run, fn: 'intake.save_update' }),
      sql: 'select intake.save_update($1::jsonb) as answer',
      values: (r) => [JSON.stringify(r)],
    },
    {
      name: 'an update, by the console',
      record: update,
      save: (run) => saveUpdate(update(), { run, fn: 'social.admin_save_update' }),
      sql: 'select social.admin_save_update($1::jsonb) as answer',
      values: (r) => [JSON.stringify(r)],
    },
  ];

  it.each(cases)('$name: one transaction, one statement, the record as it is', async (c) => {
    const { run, calls } = fake({ id: ID, saved: 'new' });
    const result = await c.save(run);
    expect(result).toEqual({ ok: true, id: ID, saved: 'new', answer: { id: ID, saved: 'new' } });
    expect(calls.runs).toBe(1);
    expect(calls.statements).toEqual([{ text: c.sql, values: c.values(c.record()) }]);
    expect(calls.committed).toBe(1);
  });

  it('maps each answer: new, changed and the same', async () => {
    for (const saved of ['new', 'changed', 'same'] as const) {
      const { run } = fake({ id: ID, saved });
      expect(await saveStory(story(), { run, fn: 'intake.save_story' })).toMatchObject({
        ok: true,
        saved,
      });
    }
  });

  it("passes the console's whole answer on: the tile, `listed` and the update's story", async () => {
    const tile = {
      id: ID,
      title: 'A title',
      listed: false,
      made_by: 'console',
      state: 'live',
      saved: 'new',
    };
    const { run } = fake(tile);
    const result = await saveStory(story(), { run, fn: 'social.admin_save_story', listed: false });
    expect(result).toMatchObject({ ok: true, answer: tile });
    const { run: runUpdate } = fake({ id: ID, story_id: ID, saved: 'same' });
    expect(
      await saveUpdate(update(), { run: runUpdate, fn: 'social.admin_save_update' }),
    ).toMatchObject({
      ok: true,
      saved: 'same',
      answer: { story_id: ID },
    });
  });

  it('reads an answer the driver gave as text, and refuses one that is not an answer', async () => {
    const { run } = fake(JSON.stringify({ id: ID, saved: 'changed' }));
    expect(await saveStory(story(), { run, fn: 'intake.save_story' })).toMatchObject({
      ok: true,
      saved: 'changed',
    });
    for (const odd of [
      null,
      undefined,
      'nothing',
      {},
      { id: ID },
      { id: ID, saved: 'older' },
      { id: 5, saved: 'new' },
    ]) {
      const { run: runOdd } = fake(odd);
      await expect(saveStory(story(), { run: runOdd, fn: 'intake.save_story' })).rejects.toThrow(
        /answer/,
      );
    }
  });

  it('saves every example story and update the agreement holds', async () => {
    for (const record of examples('stories.json')) {
      const { run, calls } = fake({ id: record.id, saved: 'new' });
      expect(await saveStory(record, { run, fn: 'intake.save_story' })).toMatchObject({ ok: true });
      expect(calls.statements).toHaveLength(1);
    }
    for (const record of examples('updates.json')) {
      const { run, calls } = fake({ id: record.id, saved: 'new' });
      expect(await saveUpdate(record, { run, fn: 'intake.save_update' })).toMatchObject({
        ok: true,
      });
      expect(calls.statements).toHaveLength(1);
    }
  });
});

describe("the database's refusals", () => {
  const story1: StoryTarget['fn'] = 'intake.save_story';

  it('an older record is "older"; a changed `listed` is "listing_fixed"', async () => {
    const older = fake(null, { atStatement: failure('HZS19') });
    expect(await saveStory(story(), { run: older.run, fn: story1 })).toEqual({
      ok: false,
      reason: 'older',
    });
    const fixed = fake(null, { atStatement: failure('HZS25') });
    expect(
      await saveStory(story(), { run: fixed.run, fn: 'social.admin_save_story', listed: true }),
    ).toEqual({ ok: false, reason: 'listing_fixed' });
  });

  it("the content store's rules come back with their name, their sentence and their hint", async () => {
    const rule = failure('23514', {
      constraint: 'updates_correction_comes_later',
      message: 'Update u2 corrects update u1, which is not earlier',
      hint: 'A correction is reported after what it corrects',
    });
    const { run, calls } = fake(null, { atStatement: rule });
    expect(await saveUpdate(update(), { run, fn: 'intake.save_update' })).toEqual({
      ok: false,
      reason: 'refused',
      code: '23514',
      constraint: 'updates_correction_comes_later',
      message: 'Update u2 corrects update u1, which is not earlier',
      hint: 'A correction is reported after what it corrects',
    });
    expect(calls.runs).toBe(1);
  });

  it('an error raised when the transaction commits is mapped exactly as one raised by the statement', async () => {
    const deferred = {
      constraint: 'updates_based_on_sourced_items',
      message: 'Update 01a1 is based on a sourced item that does not exist',
    };
    const atStatement = fake(null, { atStatement: failure('23503', deferred) });
    const atCommit = fake({ id: ID, saved: 'new' }, { atCommit: failure('23503', deferred) });
    const fromStatement = await saveUpdate(update(), {
      run: atStatement.run,
      fn: 'intake.save_update',
    });
    const fromCommit = await saveUpdate(update(), { run: atCommit.run, fn: 'intake.save_update' });
    expect(fromCommit).toEqual(fromStatement);
    expect(fromCommit).toMatchObject({
      ok: false,
      reason: 'refused',
      code: '23503',
      constraint: 'updates_based_on_sourced_items',
      hint: null,
    });
    // The statement itself ran and its answer was never reported: the save didn't happen.
    expect(atCommit.calls.statements).toHaveLength(1);
    expect(atCommit.calls.committed).toBe(0);
    // A story's own deferred rule, and "older" at commit, map too.
    const merge = fake(
      { id: ID, saved: 'new' },
      { atCommit: failure('23514', { constraint: 'stories_merges_never_chain' }) },
    );
    expect(await saveStory(story(), { run: merge.run, fn: story1 })).toMatchObject({
      ok: false,
      reason: 'refused',
      constraint: 'stories_merges_never_chain',
    });
    const late = fake({ id: ID, saved: 'new' }, { atCommit: failure('HZS19') });
    expect(await saveStory(story(), { run: late.run, fn: story1 })).toEqual({
      ok: false,
      reason: 'older',
    });
  });

  it("values the database cannot read and the function's own checks are refusals too", async () => {
    for (const code of ['22023', '22P02', '22007', '22003', '23502', '23505']) {
      const { run } = fake(null, {
        atStatement: failure(code, { message: 'A story has no field called color' }),
      });
      expect(await saveStory(story(), { run, fn: story1 })).toMatchObject({
        ok: false,
        reason: 'refused',
        code,
        constraint: null,
        message: 'A story has no field called color',
      });
    }
  });

  it('anything else is thrown as it came, for the caller to map', async () => {
    for (const error of [
      failure('42501'), // not an admin
      failure('HZS18'), // test stories are off here
      failure('40001'), // the database asks to try again
      failure('08006'), // the connection is gone
      new Error('plain failure'),
      Object.assign(new Error('The database is busy: try again'), { name: 'DatabaseBusyError' }),
    ]) {
      const { run } = fake(null, { atStatement: error });
      await expect(saveStory(story(), { run, fn: story1 })).rejects.toBe(error);
      const atCommit = fake({ id: ID, saved: 'new' }, { atCommit: error });
      await expect(
        saveUpdate(update(), { run: atCommit.run, fn: 'intake.save_update' }),
      ).rejects.toBe(error);
    }
  });

  it('never retries: a refusal is one transaction, one statement', async () => {
    const { run, calls } = fake(null, { atStatement: failure('HZS19') });
    await saveStory(story(), { run, fn: story1 });
    expect(calls.runs).toBe(1);
    expect(calls.statements).toHaveLength(1);
    expect(calls.committed).toBe(0);
  });
});

describe('the update target type', () => {
  it('names only the two update functions', () => {
    const targets: UpdateTarget['fn'][] = ['intake.save_update', 'social.admin_save_update'];
    expect(targets).toHaveLength(2);
  });
});

describe("the caller's transaction", () => {
  it('is `transaction()` of @hrizzup/db: its type fits `RunTransaction`, which `tsc` proves', () => {
    const withPool =
      (pool: Parameters<typeof transaction>[0]): RunTransaction =>
      (work) =>
        transaction(pool, work, { account: null });
    expect(withPool).toBeTypeOf('function');
  });
});
