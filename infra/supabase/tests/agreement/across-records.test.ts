import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connect, transactions } from './database.ts';
import { changed, examplesOf, type Item, loadExamples, newId, save } from './records.ts';

/**
 * The rules that span records, which `validate()` can't see one record at a time: the content
 * store holds them itself, checked when a transaction commits (agreement/README.md; the full list
 * is in infra/supabase/content-store.md). Each test starts from every example, loaded and settled.
 */

let db: pg.Client;
const tx = transactions(() => db);
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db?.end();
});
beforeEach(async () => {
  await tx.begin();
  await loadExamples(db);
  await tx.settle();
});
afterEach(() => tx.rollback());

const stories = examplesOf('story/1');
const updates = examplesOf('update/1');
const sourced = examplesOf('sourced/1');
const creations = examplesOf('creation/1');
const byId = (list: Item[], id: unknown) => list.find((r) => r.id === id) as Item;

const duplicate = stories.find((s) => s.state === 'merged') as Item;
const kept = byId(stories, duplicate.merged_into);
const other = stories.find((s) => s.state === 'live' && s.id !== kept.id) as Item;
const take = sourced.find((s) => s.kind === 'take' && s.state === 'live') as Item;
const withdrawnTake = sourced.find((s) => s.state === 'withdrawn') as Item;
const correction = updates.find((u) => u.corrects) as Item;
const corrected = byId(updates, correction.corrects);
const repeat = updates.find((u) => u.state === 'merged') as Item;
const repeated = byId(updates, repeat.merged_into);
const basedOnPosts = updates.find((u) => u.based_on && u.state === 'live') as Item;
const ourExplainer = creations.find((c) => c.based_on) as Item;

const run =
  (sql: string, ...values: unknown[]) =>
  () =>
    db.query(sql, values);

/** A new story, alone, with nothing in it: enough to try a merge on. */
function freshStory(): Item {
  return changed(other, (s) => {
    s.id = newId();
  });
}
/** A new live update in a story, based on a page. */
function freshUpdate(storyId: unknown, reportedAt = '2026-11-05T09:30:00Z'): Item {
  return {
    format: 'update/1',
    id: newId(),
    story_id: storyId,
    headline: 'A test development in this story',
    reported_at: reportedAt,
    sources: ['https://example.com/sources/test'],
    state: 'live',
    created_at: reportedAt,
    updated_at: reportedAt,
  };
}

async function refused(change: () => Promise<unknown>, constraint: string | string[]) {
  const error = await tx.attempt(change);
  expect(error, 'the database refused it').not.toBeNull();
  expect([constraint].flat(), error?.message).toContain(error?.constraint);
}
async function accepted(change: () => Promise<unknown>) {
  const error = await tx.attempt(change);
  expect(error?.message ?? null).toBeNull();
}

describe('one item per post', () => {
  it('refuses a second item for a post the pool already keeps', async () => {
    await refused(
      () =>
        save(
          db,
          changed(take, (s) => (s.id = newId())),
        ),
      'sourced_items_one_per_post',
    );
  });

  it('knows the post by its number, whatever the handle in its address', async () => {
    const number = String((take.post as Item).url)
      .split('/')
      .pop();
    const renamed = changed(take, (s) => {
      s.id = newId();
      (s.post as Item).handle = 'example_renamed';
      (s.post as Item).url = `https://x.com/example_renamed/status/${number}`;
    });
    await refused(() => save(db, renamed), 'sourced_items_one_per_post');
  });

  it("keeps a withdrawn item's post, so the same post isn't kept again", async () => {
    await refused(
      () =>
        save(
          db,
          changed(withdrawnTake, (s) => {
            s.id = newId();
            s.state = 'live';
            delete s.withdrawn_reason;
          }),
        ),
      'sourced_items_one_per_post',
    );
  });

  it('keeps a post again, as a new item, once the item that held it is unavailable', async () => {
    await accepted(async () => {
      await db.query(
        `update content.sourced_items set state = 'unavailable', post_url = null, post_handle = null,
           post_name = null, post_posted_at = null, post_media = null, summary = null where id = $1`,
        [take.id],
      );
      await save(
        db,
        changed(take, (s) => (s.id = newId())),
      );
    });
  });

  it('refuses an address that names another handle than the post’s', async () => {
    await refused(
      run(`update content.sourced_items set post_handle = 'example_other' where id = $1`, take.id),
      'sourced_items_address_names_the_handle',
    );
  });

  it('takes an address whose handle differs only in letter case: handles on X ignore it', async () => {
    await accepted(
      run(
        `update content.sourced_items set post_handle = upper(post_handle) where id = $1`,
        take.id,
      ),
    );
  });
});

describe('an unavailable item keeps nothing of the post, for good', () => {
  const gone = sourced.find((s) => s.state === 'unavailable') as Item;

  it('refuses to fill an unavailable item with a post again', async () => {
    await refused(
      run(
        `update content.sourced_items set post_url = 'https://x.com/example_back/status/9900000000000000999',
           post_handle = 'example_back', post_posted_at = now(), post_media = 'text' where id = $1`,
        gone.id,
      ),
      'sourced_items_unavailable_keeps_nothing_of_the_post',
    );
  });

  it('refuses to make an unavailable item live again', async () => {
    await refused(run(`update content.sourced_items set state = 'live' where id = $1`, gone.id), [
      'sourced_items_unavailable_is_final',
      'sourced_items_keeps_its_post_while_available',
    ]);
  });
});

describe('merges never chain', () => {
  it.each([
    [
      'a story merged into itself',
      `update content.stories set state = 'merged', merged_into = id where id = $1`,
      'stories_not_merged_into_itself',
    ],
    [
      'an update merged into itself',
      `update content.updates set state = 'merged', merged_into = id where id = $1`,
      'updates_not_merged_into_itself',
    ],
    [
      'an update correcting itself',
      'update content.updates set corrects = id where id = $1',
      'updates_not_correcting_itself',
    ],
  ])('refuses %s', async (_, sql, constraint) => {
    const id = sql.includes('stories')
      ? other.id
      : (updates.find((u) => u.state === 'live') as Item).id;
    await refused(run(sql, id), constraint);
  });

  it('refuses a merge into a story that is merged itself', async () => {
    const story = freshStory();
    await save(db, story);
    await tx.settle();
    await refused(
      run(
        `update content.stories set state = 'merged', merged_into = $2 where id = $1`,
        story.id,
        duplicate.id,
      ),
      'stories_merges_never_chain',
    );
  });

  it('refuses to merge a story that others went into, unless they are repointed in the same transaction', async () => {
    const mergeKept = async () => {
      // A full merge of the kept story into another: its updates and sourced items move.
      await db.query('update content.updates set story_id = $2 where story_id = $1', [
        kept.id,
        other.id,
      ]);
      await db.query(
        `update content.sourced_items set story_ids = array_replace(story_ids, $1::uuid, $2::uuid)
         where story_ids @> array[$1::uuid]`,
        [kept.id, other.id],
      );
      await db.query(
        `update content.stories set state = 'merged', merged_into = $2 where id = $1`,
        [kept.id, other.id],
      );
    };
    await refused(mergeKept, 'stories_merges_never_chain');
    await accepted(async () => {
      await mergeKept();
      await db.query('update content.stories set merged_into = $2 where merged_into = $1', [
        kept.id,
        other.id,
      ]);
    });
  });

  it('refuses a repeat of an update that is merged itself', async () => {
    const update = changed(freshUpdate(kept.id, String(repeat.reported_at)), (u) => {
      u.state = 'merged';
      u.merged_into = repeat.id;
    });
    await refused(() => save(db, update), 'updates_merges_never_chain');
  });

  it('refuses to merge an update that others repeat, unless they are repointed', async () => {
    const target = freshUpdate(kept.id);
    await save(db, target);
    await tx.settle();
    const mergeRepeated = () =>
      db.query(`update content.updates set state = 'merged', merged_into = $2 where id = $1`, [
        repeated.id,
        target.id,
      ]);
    await refused(mergeRepeated, 'updates_merges_never_chain');
    await accepted(async () => {
      await mergeRepeated();
      await db.query('update content.updates set merged_into = $2 where merged_into = $1', [
        repeated.id,
        target.id,
      ]);
    });
  });
});

describe("a merge moves the duplicate's updates and sourced items to the story that stays", () => {
  it('refuses a merged story that still has updates', async () => {
    const story = freshStory();
    await save(db, story);
    await save(db, freshUpdate(story.id));
    await tx.settle();
    await refused(
      run(
        `update content.stories set state = 'merged', merged_into = $2 where id = $1`,
        story.id,
        kept.id,
      ),
      'stories_merge_moves_its_updates',
    );
  });

  it('refuses a merged story that sourced items still name', async () => {
    const story = freshStory();
    await save(db, story);
    await db.query(
      'update content.sourced_items set story_ids = story_ids || $2::uuid where id = $1',
      [take.id, story.id],
    );
    await tx.settle();
    await refused(
      run(
        `update content.stories set state = 'merged', merged_into = $2 where id = $1`,
        story.id,
        kept.id,
      ),
      'stories_merge_moves_its_sourced_items',
    );
  });

  it('refuses a new update in a merged story', async () => {
    await refused(() => save(db, freshUpdate(duplicate.id)), 'updates_story_is_not_merged');
  });

  it('refuses a sourced item that names a merged story', async () => {
    await refused(
      run(
        'update content.sourced_items set story_ids = array[$2::uuid] where id = $1',
        take.id,
        duplicate.id,
      ),
      'sourced_items_story_is_not_merged',
    );
  });

  it('takes a post that names a merged story: it is read as naming the story that one went into', async () => {
    await accepted(
      run(
        'update content.creations set story_ids = array[$2::uuid] where id = $1',
        creations[0]?.id,
        duplicate.id,
      ),
    );
  });
});

describe('a correction names an earlier, live update in the same story', () => {
  const correct = (
    target: unknown,
    storyId: unknown = kept.id,
    reportedAt = '2026-11-06T00:00:00Z',
  ) =>
    save(
      db,
      changed(freshUpdate(storyId, reportedAt), (u) => (u.corrects = target)),
    );

  it('refuses a correction in another story', async () => {
    await refused(() => correct(corrected.id, other.id), 'updates_correction_stays_in_its_story');
  });

  it('refuses a correction of a later update', async () => {
    await refused(
      () => correct(corrected.id, kept.id, '2026-11-01T00:00:00Z'),
      'updates_correction_comes_later',
    );
  });

  it('refuses a correction of an update that is not live', async () => {
    await db.query(
      `update content.updates set state = 'withdrawn', withdrawn_reason = 'Untrue.' where id = $1`,
      [corrected.id],
    );
    await refused(() => correct(corrected.id), 'updates_correction_names_a_live_update');
  });

  it('still lets a corrected update be withdrawn: nothing stops a takedown', async () => {
    await accepted(
      run(
        `update content.updates set state = 'withdrawn', withdrawn_reason = 'Taken down.' where id = $1`,
        corrected.id,
      ),
    );
  });

  it('refuses moving a corrected update out of its correction’s story', async () => {
    await refused(
      run('update content.updates set story_id = $2 where id = $1', corrected.id, other.id),
      ['updates_correction_stays_in_its_story', 'updates_repeat_stays_in_its_story'],
    );
  });
});

describe('a repeat names a live update in the same story', () => {
  const repeatOf = (target: unknown, storyId: unknown = kept.id) =>
    save(
      db,
      changed(freshUpdate(storyId), (u) => {
        u.state = 'merged';
        u.merged_into = target;
      }),
    );

  it('refuses a repeat of an update in another story', async () => {
    await refused(() => repeatOf(repeated.id, other.id), 'updates_repeat_stays_in_its_story');
  });

  it('refuses a repeat of an update that is withdrawn', async () => {
    const withdrawn = updates.find((u) => u.state === 'withdrawn') as Item;
    await refused(
      () => repeatOf(withdrawn.id, withdrawn.story_id),
      'updates_repeat_names_a_live_update',
    );
  });

  it('still lets a repeated update be withdrawn', async () => {
    await accepted(
      run(
        `update content.updates set state = 'withdrawn', withdrawn_reason = 'Taken down.' where id = $1`,
        repeated.id,
      ),
    );
  });
});

describe('what a record names exists', () => {
  const missing = newId();
  it.each([
    [
      'an update based on a sourced item that does not exist',
      () =>
        save(
          db,
          changed(freshUpdate(kept.id), (u) => (u.based_on = [missing])),
        ),
      'updates_based_on_sourced_items',
    ],
    [
      'an update in a story that does not exist',
      () => save(db, freshUpdate(missing)),
      'updates_story_id_story',
    ],
    [
      'a correction of an update that does not exist',
      () =>
        save(
          db,
          changed(freshUpdate(kept.id), (u) => (u.corrects = missing)),
        ),
      'updates_corrects_update',
    ],
    [
      'a repeat of an update that does not exist',
      () =>
        save(
          db,
          changed(freshUpdate(kept.id), (u) => {
            u.state = 'merged';
            u.merged_into = missing;
          }),
        ),
      'updates_merged_into_update',
    ],
    [
      'a story merged into one that does not exist',
      () =>
        db.query(`update content.stories set state = 'merged', merged_into = $2 where id = $1`, [
          other.id,
          missing,
        ]),
      'stories_merged_into_story',
    ],
    [
      'a sourced item that names a story that does not exist',
      () =>
        db.query('update content.sourced_items set story_ids = array[$2::uuid] where id = $1', [
          take.id,
          missing,
        ]),
      'sourced_items_story_ids_stories',
    ],
    [
      'a post on a story that does not exist',
      () =>
        db.query('update content.creations set story_ids = array[$2::uuid] where id = $1', [
          ourExplainer.id,
          missing,
        ]),
      'creations_story_ids_stories',
    ],
    [
      'our own post built on a sourced item that does not exist',
      () =>
        db.query('update content.creations set based_on = array[$2::uuid] where id = $1', [
          ourExplainer.id,
          missing,
        ]),
      'creations_based_on_sourced_items',
    ],
    [
      'a post from an account that does not exist',
      () =>
        save(
          db,
          changed(ourExplainer, (c) => {
            c.id = newId();
            (c.author as Item).account_id = missing;
          }),
        ),
      'creations_author_account_id_account',
    ],
  ] as [string, () => Promise<unknown>, string][])('refuses %s', async (_, change, constraint) => {
    await refused(change, constraint);
  });

  /** A new story that only `name` names, so removing it breaks just that one rule. */
  async function storyNamedBy(name: (storyId: unknown) => Promise<unknown>) {
    const story = freshStory();
    await save(db, story);
    await name(story.id);
    await tx.settle();
    return run('delete from content.stories where id = $1', story.id);
  }

  it('refuses removing a story that a sourced item names', async () => {
    const remove = await storyNamedBy((id) =>
      db.query('update content.sourced_items set story_ids = story_ids || $2::uuid where id = $1', [
        take.id,
        id,
      ]),
    );
    await refused(remove, 'sourced_items_story_ids_stories');
  });

  it('refuses removing a story that a post is on', async () => {
    const remove = await storyNamedBy((id) =>
      db.query('update content.creations set story_ids = array[$2::uuid] where id = $1', [
        ourExplainer.id,
        id,
      ]),
    );
    await refused(remove, 'creations_story_ids_stories');
  });

  it('refuses removing a story with updates', async () => {
    const remove = await storyNamedBy((id) => save(db, freshUpdate(id)));
    await refused(remove, 'updates_story_id_story');
  });

  it.each([
    [
      'a sourced item an update is based on',
      () =>
        db.query('delete from content.sourced_items where id = $1', [
          (basedOnPosts.based_on as string[])[0],
        ]),
      'updates_based_on_sourced_items',
    ],
    [
      'a sourced item our own post builds on',
      () =>
        db.query('delete from content.sourced_items where id = $1', [
          (ourExplainer.based_on as string[])[0],
        ]),
      'creations_based_on_sourced_items',
    ],
    [
      'every sourced item at once, while updates name some',
      () => db.query('truncate content.sourced_items'),
      'sourced_items_still_named',
    ],
    [
      'every story at once (with the updates in them), while sourced items name some',
      () => db.query('truncate content.stories, content.updates'),
      'stories_still_named',
    ],
  ] as [string, () => Promise<unknown>, string][])(
    'refuses removing %s',
    async (_, change, constraint) => {
      await refused(change, constraint);
    },
  );

  it('takes removing everything together, in any order', async () => {
    await accepted(async () => {
      await db.query('delete from content.stories');
      await db.query('delete from content.sourced_items');
      await db.query('delete from content.updates');
      await db.query('delete from content.creations');
    });
  });
});

describe("a record's ID never changes", () => {
  it.each([
    ['stories', stories[0]?.id],
    ['updates', updates[0]?.id],
    ['sourced_items', sourced[0]?.id],
    ['creations', creations[0]?.id],
  ])('in %s', async (table, id) => {
    await refused(
      run(`update content.${table} set id = $2 where id = $1`, id, newId()),
      `${table}_id_never_changes`,
    );
  });
});

describe('the content store is changed only in read committed transactions', () => {
  const write = () => save(db, freshStory());

  it.each(['repeatable read', 'serializable'])(
    'refuses a change in a %s transaction',
    async (level) => {
      await db.query('rollback');
      await db.query(`begin isolation level ${level}`);
      await expect(write()).rejects.toMatchObject({ code: '25000' });
    },
  );

  it('takes one in read committed, Postgres’s default', async () => {
    await db.query('rollback');
    await db.query('begin');
    await expect(write()).resolves.toBeUndefined();
  });
});

describe('two transactions at once can’t break a rule between them', () => {
  // Real commits, on two connections, cleaned up afterwards.
  let other1: pg.Client;
  let other2: pg.Client;
  const made: { stories: string[]; updates: string[]; sourced: string[] } = {
    stories: [],
    updates: [],
    sourced: [],
  };

  beforeEach(async () => {
    await tx.rollback(); // this connection's own transaction isn't needed here
    other1 = await connect();
    other2 = await connect();
  });
  afterEach(async () => {
    await other1?.end();
    await other2?.end();
    await db.query('begin');
    await db.query('delete from content.updates where id = any($1::uuid[])', [made.updates]);
    await db.query('delete from content.sourced_items where id = any($1::uuid[])', [made.sourced]);
    await db.query(
      'update content.stories set merged_into = null, state = $2 where id = any($1::uuid[])',
      [made.stories, 'live'],
    );
    await db.query('delete from content.stories where id = any($1::uuid[])', [made.stories]);
    await db.query('commit');
    made.stories = [];
    made.updates = [];
    made.sourced = [];
  });

  it('two merges that would make a chain: one waits, then is refused', async () => {
    const [x, y, z] = [freshStory(), freshStory(), freshStory()];
    await db.query('begin');
    for (const s of [x, y, z]) await save(db, s);
    await db.query('commit');
    made.stories.push(...[x, y, z].map((s) => String(s.id)));

    await other1.query('begin');
    await other1.query(
      `update content.stories set state = 'merged', merged_into = $2 where id = $1`,
      [x.id, y.id],
    );
    await other2.query('begin');
    await other2.query(
      `update content.stories set state = 'merged', merged_into = $2 where id = $1`,
      [y.id, z.id],
    );

    const first = other1.query('commit').then(
      () => null,
      (error: pg.DatabaseError) => error,
    );
    await other2.query('commit');
    const error = await first;
    expect(error?.constraint).toBe('stories_merges_never_chain');
  });

  it('a story merged while an update is written into it: the update is refused', async () => {
    const [story, kept] = [freshStory(), freshStory()];
    await db.query('begin');
    for (const s of [story, kept]) await save(db, s);
    await db.query('commit');
    made.stories.push(String(story.id), String(kept.id));

    const update = freshUpdate(story.id);
    made.updates.push(String(update.id));
    await other1.query('begin');
    await save(other1, update);
    await other2.query('begin');
    await other2.query(
      `update content.stories set state = 'merged', merged_into = $2 where id = $1`,
      [story.id, kept.id],
    );
    const first = other1.query('commit').then(
      () => null,
      (error: pg.DatabaseError) => error,
    );
    await other2.query('commit');
    expect((await first)?.constraint).toBe('updates_story_is_not_merged');
  });

  it('a story removed while a sourced item is made to name it: the item is refused', async () => {
    const [home, story] = [freshStory(), freshStory()];
    const item = changed(take, (s) => {
      s.id = newId();
      (s.post as Item).url = 'https://x.com/example_race/status/9900000000000000556';
      (s.post as Item).handle = 'example_race';
      s.story_ids = [home.id];
    });
    await db.query('begin');
    for (const s of [home, story]) await save(db, s);
    await save(db, item);
    await db.query('commit');
    made.stories.push(String(home.id), String(story.id));
    made.sourced.push(String(item.id));

    await other1.query('begin');
    await other1.query(
      'update content.sourced_items set story_ids = story_ids || $2::uuid where id = $1',
      [item.id, story.id],
    );
    await other2.query('begin');
    await other2.query('delete from content.stories where id = $1', [story.id]);
    const first = other1.query('commit').then(
      () => null,
      (error: pg.DatabaseError) => error,
    );
    await other2.query('commit');
    expect((await first)?.constraint).toBe('sourced_items_story_ids_stories');
  });

  it('a sourced item removed while an update is written on it: the update is refused', async () => {
    const story = freshStory();
    const item = changed(take, (s) => {
      s.id = newId();
      (s.post as Item).url = 'https://x.com/example_race/status/9900000000000000555';
      (s.post as Item).handle = 'example_race';
      s.story_ids = [story.id];
    });
    await db.query('begin');
    await save(db, story);
    await save(db, item);
    await db.query('commit');
    made.stories.push(String(story.id));
    made.sourced.push(String(item.id));

    const update = changed(freshUpdate(story.id), (u) => (u.based_on = [item.id]));
    made.updates.push(String(update.id));
    await other1.query('begin');
    await save(other1, update);
    await other2.query('begin');
    await other2.query('delete from content.sourced_items where id = $1', [item.id]);
    await other2.query('commit');
    await expect(other1.query('commit')).rejects.toMatchObject({
      constraint: 'updates_based_on_sourced_items',
    });
  });
});
