import { DEFAULT_PAGE } from '@hrizzup/api';
import type { CursorShapes } from '@hrizzup/social/cursor';
import { boardLists, placesFor } from '@hrizzup/social/lists';
import { deskTag, storyTag } from '@hrizzup/social/tags';
import type { ORPCError } from '@orpc/server';
import { asApp } from '@/lib/social/access.ts';
import { loadBrief } from '@/lib/social/brief.ts';
import { refusalOf } from '@/lib/social/errors.ts';
import { cursorFrom, cursorText, nextFrom, type Page } from '@/lib/social/paging.ts';
import { type PostRow, postCardOf } from '@/lib/social/post-card.ts';
import { answerOf } from '@/lib/social/shape.ts';
import {
  type LiveStoryRow,
  type StoryTileRow,
  storyDetailOf,
  storyTileOf,
  type UpdateRow,
  updateOf,
  type WithdrawnStoryRow,
} from '@/lib/social/stories.ts';
import { api } from '../base.ts';

/**
 * The board and the stories (R5; docs/social/build.md, sections 5, 5.1 and 6; R5's design note, M1):
 * social's six public reads, each one call of one database function as nobody (`asApp`), mapped
 * field by field (`lib/social/stories.ts`, `post-card.ts`), kept at Vercel's edge for a minute and
 * tagged with the ID asked for and every story its answer shows (lower case, as the tag builders
 * insist), so a save purges exactly what it changed.
 *
 * - **A story the database doesn't know is 404 "No such story"** (P0002); a bad cursor is 400 with the
 *   issue on `cursor`; `limit` is always sent (50 when the caller sends none: the database would
 *   read a missing one as 20).
 * - **A merged story answers the story it went into** (with `requestedId`), a withdrawn one its state
 *   and reason, its updates and posts empty and its brief 422 `story_not_live`.
 * - **Tags are added only after the answer is mapped**, so a read that fails tags nothing.
 */

/** One call of one social function as nobody, answering what it answers. */
const answered = <T>(sql: string, values: unknown[]): Promise<T> =>
  asApp(async (tx) => answerOf((await tx.query(sql, values)).rows) as T);

export const boardRoutes = {
  social: {
    /** What the board's filters offer, made from the agreement's lists: no database, no tags beyond the family's. */
    lists: api.social.lists.handler(() => {
      const lists = boardLists();
      return { ...lists, sorts: [...lists.sorts] };
    }),

    board: api.social.board.handler(async ({ input }) => {
      const sort = input?.sort ?? 'top';
      const kind = sort === 'top' ? 'top' : 'time';
      const cursor = cursorFrom(kind, input?.cursor);
      const places = input?.place === undefined ? null : placesFor(input.place);
      const page = await answered<
        Page<'stories', StoryTileRow, CursorShapes['top'] | CursorShapes['time']>
      >('select social.board($1, $2, $3::text[], $4::jsonb, $5) as answer', [
        sort,
        input?.category ?? null,
        places,
        cursorText(cursor),
        input?.limit ?? DEFAULT_PAGE,
      ]);
      return {
        stories: page.stories.map(storyTileOf),
        next: nextFrom(kind, page.next),
      };
    }),

    stories: {
      get: api.social.stories.get.handler(async ({ input, context }) => {
        const id = input.id.toLowerCase();
        const row = await answered<LiveStoryRow | WithdrawnStoryRow>(
          'select social.story($1) as answer',
          [id],
        );
        const story = storyDetailOf(row);
        // The ID asked for and the story answered, which differ when the one asked for was merged.
        context.tags.add(storyTag(id), storyTag(story.id));
        return story;
      }),

      updates: api.social.stories.updates.handler(async ({ input, context }) => {
        const id = input.id.toLowerCase();
        const cursor = cursorFrom('time', input.cursor);
        const page = await answered<Page<'updates', UpdateRow, CursorShapes['time']>>(
          'select social.story_updates($1, $2::jsonb, $3) as answer',
          [id, cursorText(cursor), input.limit ?? DEFAULT_PAGE],
        );
        const answer = { updates: page.updates.map(updateOf), next: nextFrom('time', page.next) };
        // An update carries no story ID, so a merged ID learns of its survivor's change by the edge life.
        context.tags.add(storyTag(id));
        return answer;
      }),

      posts: api.social.stories.posts.handler(async ({ input, context }) => {
        const id = input.id.toLowerCase();
        const sort = input.sort ?? 'top';
        const kind = sort === 'top' ? 'top' : 'id';
        const cursor = cursorFrom(kind, input.cursor);
        const page = await answered<
          Page<'posts', PostRow, CursorShapes['top'] | CursorShapes['id']>
        >('select social.desk($1, $2, $3::jsonb, $4) as answer', [
          id,
          sort,
          cursorText(cursor),
          input.limit ?? DEFAULT_PAGE,
        ]);
        const answer = {
          posts: page.posts.map(postCardOf),
          next: nextFrom(kind, page.next),
        };
        // The desk asked for, and the desk the posts belong to (a merged story's is its survivor's).
        context.tags.add(deskTag(id));
        const first = answer.posts[0];
        if (first) context.tags.add(deskTag(first.storyId));
        return answer;
      }),

      brief: api.social.stories.brief.handler(async ({ input, context }) => {
        const id = input.id.toLowerCase();
        const brief = await loadBrief(id);
        if (brief === null) throw refusalOf('HZS22') as ORPCError<string, unknown>;
        context.tags.add(
          storyTag(id),
          deskTag(id),
          storyTag(brief.storyId),
          deskTag(brief.storyId),
        );
        return brief;
      }),
    },
  },
};
