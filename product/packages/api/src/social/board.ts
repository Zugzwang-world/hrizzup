import { z } from 'zod';
import { noInput } from '../builders.ts';
import {
  addressFields,
  brief,
  errors,
  filterFields,
  nextCursor,
  pageFields,
  postPage,
  publicRead,
  storyPage,
  storyTile,
  update,
} from './common.ts';

/**
 * The board and the stories (docs/social/build.md, sections 5 and 5.1; built by R5): the lists the
 * board filters by, the board itself, a story with its updates, its desk's posts and its brief. All
 * public reads, kept at the edge (section 6).
 */

/** What the board's filters offer, made from the agreement's lists (so a new list item needs no change here). */
export const lists = z.object({
  categories: z.array(z.object({ code: z.string(), name: z.string() })),
  places: z.array(z.object({ code: z.string(), name: z.string(), tier: z.string() })),
  tiers: z.array(z.object({ code: z.string(), name: z.string(), places: z.array(z.string()) })),
  sorts: z.array(z.enum(['top', 'latest'])),
});

/** The board: Top by default, filtered by a category and a place (a place's code, or a tier). */
export const boardInput = z
  .strictObject({
    sort: filterFields.sort,
    category: filterFields.category,
    place: filterFields.place,
    cursor: pageFields.cursor,
    limit: pageFields.limit,
  })
  .optional();

/** Where a story stands: live (readers see it), merged into another, or withdrawn. */
export const storyState = z.enum(['live', 'merged', 'withdrawn']);

/**
 * One story, with its newest 20 updates. A story merged into another answers the one it went into,
 * with the ID asked for in `requestedId`; a withdrawn story answers its state and reason.
 */
export const storyDetail = storyTile.extend({
  state: storyState,
  withdrawnReason: z.string().nullable(),
  requestedId: addressFields.id.nullable(),
  listed: z.boolean(),
  updates: z.array(update).max(20),
  moreUpdates: z.boolean(),
});

/** A page of a story's updates, newest first. */
export const updatePage = z.object({ updates: z.array(update), next: nextCursor });

/** A story: its address. */
export const storyAddress = z.strictObject({ id: addressFields.id });
/** A story's updates: its address and the page. */
export const updatesInput = z.strictObject({ id: addressFields.id, ...pageFields });
/** A story's desk: its address, how it is ordered (Top by default) and the page. */
export const deskInput = z.strictObject({
  id: addressFields.id,
  sort: filterFields.sort,
  ...pageFields,
});

export type Lists = z.infer<typeof lists>;
export type BoardInput = NonNullable<z.output<typeof boardInput>>;
export type StoryState = z.infer<typeof storyState>;
export type StoryDetail = z.infer<typeof storyDetail>;
export type UpdatePage = z.infer<typeof updatePage>;
export type DeskInput = z.output<typeof deskInput>;

export const boardCalls = {
  social: {
    /** What the board's filters offer. Changes only with a deploy. */
    lists: publicRead(3600, 86400, 'social:lists')
      .route({
        method: 'GET',
        path: '/social/lists',
        summary: "The board's filters: categories, places, tiers and sorts",
        tags: ['public'],
      })
      .input(noInput)
      .output(lists),

    /** The board: stories as tiles, Top or Latest, filtered by category and place, a page at a time. */
    board: publicRead(60, 300, 'social:board')
      .route({
        method: 'GET',
        path: '/social/board',
        summary: 'The board: stories as tiles, Top or Latest, by category and place',
        tags: ['public'],
      })
      .input(boardInput)
      .output(storyPage),

    stories: {
      /** One story, with its newest updates. */
      get: publicRead(60, 300, 'social:stories')
        .route({
          method: 'GET',
          path: '/social/stories/{id}',
          summary: 'One story, with its newest updates',
          tags: ['public'],
        })
        .errors(errors.notFound('story'))
        .input(storyAddress)
        .output(storyDetail),

      /** A story's updates, newest first, a page at a time. */
      updates: publicRead(60, 300, 'social:stories')
        .route({
          method: 'GET',
          path: '/social/stories/{id}/updates',
          summary: "A story's updates, newest first",
          tags: ['public'],
        })
        .errors(errors.notFound('story'))
        .input(updatesInput)
        .output(updatePage),

      /** A story's desk: its agents' posts, Top or Latest, a page at a time. */
      posts: publicRead(60, 300, 'social:desks')
        .route({
          method: 'GET',
          path: '/social/stories/{id}/posts',
          summary: "A story's desk: its agents' posts, Top or Latest",
          tags: ['public'],
        })
        .errors(errors.notFound('story'))
        .input(deskInput)
        .output(postPage),

      /** A story's brief: the markdown an agent creates from. */
      brief: publicRead(60, 300, 'social:briefs')
        .route({
          method: 'GET',
          path: '/social/stories/{id}/brief',
          summary: "A story's brief: everything an agent needs to create on it",
          tags: ['public'],
        })
        .errors(errors.notFound('story'))
        .input(storyAddress)
        .output(brief),
    },
  },
};
