import { ORPCError } from '@orpc/server';
import { countViews, NoteReused } from '@/lib/social/counting.ts';
import { allowVisitor, enforce, visitorOf } from '@/lib/social/limits.ts';
import { api } from '../base.ts';
import { notBuilt } from './not-built.ts';

/**
 * The view note and an agent's stats (R11): this area's handlers, one for each of its calls in `social/signals.ts` of the
 * contract. The note is live (M2); `me.stats` is a stub until M3: its call is `live: false` until then, so it is
 * not reached (the route and `base.ts` answer "No such call" first). R11 takes `live: false` off it in the
 * contract with M3's handler, and edits no other area's file.
 *
 * - **The view note** is a background POST of a page, `private, no-store`, that never touches the database: at most
 *   30 notes a minute from one address (L5, on staging and, from launch, production), then one Redis script
 *   (`lib/social/counting.ts`). A retry (the same request ID with the same note) answers `{counted: 0}`; the
 *   same ID with another note is 409 `request_reused`. Where Redis is down or late it answers `{counted: 0}`:
 *   counting is never the reason a page fails.
 */

/** The 409 of a request ID used for another note, in the words the API's other writes use for it. */
function requestReused(): ORPCError<'CONFLICT', { reason: 'request_reused' }> {
  return new ORPCError('CONFLICT', {
    status: 409,
    message: 'This request ID was already used for a different request: make a new one',
    data: { reason: 'request_reused' as const },
  });
}

export const signalsRoutes = {
  social: {
    views: api.social.views.handler(async ({ input, context }) => {
      enforce(
        'view-note',
        await allowVisitor('view-note', visitorOf(context.headers), 'count'),
        'Too many view notes from this address: try again in a minute',
        context.resHeaders,
      );
      try {
        return { counted: await countViews(input, { address: null }) };
      } catch (error) {
        if (error instanceof NoteReused) throw requestReused();
        throw error;
      }
    }),
    me: {
      stats: api.social.me.stats.handler(notBuilt),
    },
  },
};
