import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { showBoard, showForYou } from '@/app/sandbox/social/reader/actions.ts';
import {
  BOARD_CHOSEN,
  FOR_YOU_PATH,
  SIGN_IN_PATH,
  TAB_COOKIE,
} from '@/app/sandbox/social/reader/tab-choice.ts';
import { serverApi } from '@/lib/api/server.ts';
import { viewer } from '@/lib/sandbox/data.ts';

/**
 * The board's "For You" tab (R12's slot, docs/social/build.md, sections 7.7 and 7.11; docs/social/r12-design.md,
 * decision 16 and section 4.3). The board (R5's page) renders it once, beside its own tab, with no props: it is a
 * reader's own, so it finds the reader itself.
 *
 * - **Signed out:** one line with a plain link to sign in. No call is made, so the board's own load (which the Speed
 *   check measures signed out) is the same as before.
 * - **Signed in, with a profile that holds something, and no remembered choice of the board:** the reader opens on
 *   For You, at `/sandbox/social/reader/for-you` (a 307). **`redirect()` stays outside any `try`: it works by
 *   throwing.** A `reader.get` that fails never breaks the board: no redirect, the tabs.
 * - **Otherwise:** the tab strip. Board is the current tab, plain text; For You is a button posting `showForYou`.
 *
 * The strip is also the For You page's (`BoardTabs`, with For You current and Board posting `showBoard`, which
 * remembers the choice in a session cookie for `/sandbox/social`, so no address of the board redirects after it).
 * Plain stock components: the design waits for the founder's references. The real board will hold its own tabs.
 */

const CURRENT =
  'inline-flex min-h-11 items-center font-semibold text-ink underline underline-offset-8';
const OTHER = 'inline-flex min-h-11 items-center text-muted';

/** The two tabs, the current one as plain text and the other a form button (a POST: a link that set a cookie would be fetched ahead). */
export function BoardTabs({ current }: { current: 'board' | 'for-you' }) {
  return (
    <nav
      aria-label="Board or For You"
      className="mt-3 flex min-w-0 flex-wrap gap-x-5"
      data-testid="board-tabs"
    >
      {current === 'board' ? (
        <span aria-current="true" className={CURRENT}>
          Board
        </span>
      ) : (
        <form action={showBoard}>
          <button type="submit" className={OTHER}>
            Board
          </button>
        </form>
      )}
      {current === 'for-you' ? (
        <span aria-current="true" className={CURRENT}>
          For You
        </span>
      ) : (
        <form action={showForYou}>
          <button type="submit" className={OTHER}>
            For You
          </button>
        </form>
      )}
    </nav>
  );
}

export async function ForYouTab() {
  const who = await viewer();
  if (!who.signedIn) {
    return (
      <p className="mt-3 text-sm" data-testid="for-you-sign-in">
        <Link
          href={SIGN_IN_PATH}
          prefetch={false}
          className="inline-flex min-h-11 items-center underline"
        >
          Sign in to get your own For You
        </Link>
      </p>
    );
  }
  let holds = false;
  try {
    holds = (await serverApi.reader.get()).holdsSomething;
  } catch {
    // The board never breaks because a reader's profile couldn't be read: no redirect, the tabs.
  }
  const chose = (await cookies()).get(TAB_COOKIE)?.value === BOARD_CHOSEN;
  if (holds && !chose) redirect(FOR_YOU_PATH);
  return <BoardTabs current="board" />;
}
