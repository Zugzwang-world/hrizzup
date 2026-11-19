'use server';

import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { serverApi } from '@/lib/api/server.ts';
import { sandboxOnly } from '@/lib/sandbox/gate.ts';
import { type Answer, saveRefusal, sendRefusal } from './answers.ts';
import {
  BOARD_CHOSEN,
  BOARD_PATH,
  FOR_YOU_PATH,
  isHttps,
  READER_PATH,
  TAB_COOKIE,
  TAB_PATH,
  tabCookieOptions,
} from './tab-choice.ts';

/**
 * The reader's buttons (docs/social/r12-design.md, sections 4.3 and 4.4), each a server action that runs in the
 * sandbox only:
 * - **`showBoard` and `showForYou`** are the board's tab strip (POST forms, since a server component can read a cookie
 *   but not set one, and a link that set it would be fetched ahead). Board remembers the choice in a session cookie
 *   for `/sandbox/social`; For You deletes it, naming the same path or the browser keeps it.
 * - **`sendMessage` and `saveProfile`** call the typed API's own calls, in process, as whoever is signed in, and
 *   answer in words (`answers.ts`); anything that is no refusal is thrown on, so the form keeps its request ID.
 *
 * Every one ends a redirect outside any `try`, since `redirect` works by throwing.
 */

/** The board tab: remembers that the reader chose the board for this browser session, then shows it. */
export async function showBoard(): Promise<void> {
  sandboxOnly();
  const secure = isHttps((await headers()).get('x-forwarded-proto'));
  (await cookies()).set(TAB_COOKIE, BOARD_CHOSEN, tabCookieOptions(secure));
  redirect(BOARD_PATH);
}

/** The For You tab: forgets the choice (the delete names the cookie's path), then shows For You. */
export async function showForYou(): Promise<void> {
  sandboxOnly();
  (await cookies()).delete({ name: TAB_COOKIE, path: TAB_PATH });
  redirect(FOR_YOU_PATH);
}

/** The agent's answer to a message, or what stopped it. `requestId` is made with the form, so a retry never sends twice. */
export async function sendMessage(requestId: string, body: string): Promise<Answer> {
  sandboxOnly();
  try {
    await serverApi.reader.chat.send({ requestId, body });
  } catch (error) {
    const refusal = sendRefusal(error);
    if (!refusal) throw error;
    // A refusal that is definitive changes what the page says (the count, the pause): show it fresh.
    if (refusal.final) revalidatePath(READER_PATH);
    return refusal;
  }
  revalidatePath(READER_PATH);
  return {
    ok: true,
    message: 'Your reader agent answered: it is in your messages below',
    issues: [],
    final: true,
  };
}

/** The reader's own save of their profile: the profile as stored comes back with the answer, for the form to show. */
export async function saveProfile(
  requestId: string,
  body: string,
): Promise<Answer & { profile: string | null }> {
  sandboxOnly();
  try {
    const saved = await serverApi.reader.saveProfile({ requestId, body });
    revalidatePath(READER_PATH);
    return { ok: true, message: 'Saved', issues: [], final: true, profile: saved.profile };
  } catch (error) {
    const refusal = saveRefusal(error);
    if (!refusal) throw error;
    return { ...refusal, profile: null };
  }
}
