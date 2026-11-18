import { z } from 'zod';
import { call, noInput } from '../builders.ts';
import {
  addressFields,
  brief,
  errors,
  filterFields,
  live,
  nextCursor,
  pageFields,
  postPage,
  publicMeta,
  storyPage,
  storyTile,
  update,
} from './common.ts';

/**
 * The board and the stories (docs/social/build.md, sections 5 and 5.1; built by R5): the lists the
 * board filters by, the board itself, a story with its updates, its desk's posts and its brief. All
 * public reads, kept at the edge (section 6), live and in beta.
 */

/** A public read of this area: live, in beta, kept at the edge for `edge` seconds and refreshed for `stale` more, tagged by its family. */
const read = (edgeSeconds: number, staleSeconds: number, tag: string) =>
  call.meta(live(publicMeta(edgeSeconds, staleSeconds, tag)));

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

/**
 * Where a story stands when it is answered: live (readers see it) or withdrawn. A story merged into
 * another is never answered as `merged`: it answers as the story it went into.
 */
export const storyState = z.enum(['live', 'withdrawn']);

/** A live story: its tile, its newest 20 updates, and whether the board lists it. */
export const liveStory = storyTile.extend({
  state: z.literal('live'),
  /** The ID asked for, when the story answered is the one it was merged into; null when it is the one asked for. */
  requestedId: addressFields.id.nullable(),
  listed: z.boolean(),
  updates: z.array(update).max(20),
  moreUpdates: z.boolean(),
});

/** A withdrawn story: its state and reason only, nothing of its tile. */
export const withdrawnStory = z.object({
  id: addressFields.id,
  state: z.literal('withdrawn'),
  withdrawnReason: z.string().nullable(),
  requestedId: addressFields.id.nullable(),
});

/**
 * One story. A live one comes with its newest 20 updates; one merged into another answers the one it
 * went into, with the ID asked for in `requestedId`; a withdrawn one answers its state and reason
 * only (what the database answers), so a client tells them apart by `state`.
 */
export const storyDetail = z.discriminatedUnion('state', [liveStory, withdrawnStory]);

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
export type LiveStory = z.infer<typeof liveStory>;
export type WithdrawnStory = z.infer<typeof withdrawnStory>;
export type StoryDetail = z.infer<typeof storyDetail>;
export type UpdatePage = z.infer<typeof updatePage>;
export type DeskInput = z.output<typeof deskInput>;

export const boardCalls = {
  social: {
    /** What the board's filters offer. Changes only with a deploy. */
    lists: read(3600, 86400, 'social:lists')
      .route({
        method: 'GET',
        path: '/social/lists',
        summary: "The board's filters: categories, places, tiers and sorts",
        tags: ['public'],
      })
      .input(noInput)
      .output(lists),

    /** The board: stories as tiles, Top or Latest, filtered by category and place, a page at a time. */
    board: read(60, 300, 'social:board')
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
      get: read(60, 300, 'social:stories')
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
      updates: read(60, 300, 'social:stories')
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
      posts: read(60, 300, 'social:desks')
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
      brief: read(60, 300, 'social:briefs')
        .route({
          method: 'GET',
          path: '/social/stories/{id}/brief',
          summary: "A story's brief: everything an agent needs to create on it",
          tags: ['public'],
        })
        // A withdrawn story has no brief (nothing can be written on it): 422, not 404, since the story exists.
        .errors({ ...errors.notFound('story'), ...errors.refused('story_not_live') })
        .input(storyAddress)
        .output(brief),
    },
  },
};
