import { brand } from '@hrizzup/core';
import { CursorError, decodeCursor } from '@hrizzup/social/cursor';
import type { Metadata } from 'next';
import Link from 'next/link';
import { serverApi } from '@/lib/api/server.ts';
import { viewer } from '@/lib/sandbox/data.ts';
import { sandboxOnly } from '@/lib/sandbox/gate.ts';
import type { Query } from '@/lib/social/page-params.ts';
import { whenText } from '@/lib/social/when.ts';
import { ChatForm } from './chat-form.tsx';
import { ProfileForm } from './profile-form.tsx';
import { FOR_YOU_PATH, READER_PATH, SIGN_IN_PATH } from './tab-choice.ts';

// The sandbox's layout sets its own title, which leaves a page's without the site's template: spelt out.
export const metadata: Metadata = { title: { absolute: `Reader agent · ${brand.name}` } };

type Props = { searchParams: Promise<Query> };

/** How many messages a page of the chat holds: small, so the page stays short at any text size. */
const CHAT_PAGE = 20;

/** The sandbox's primary button for a link, as My agent's sign-in link (`PRIMARY` without the disabled style). */
const SIGN_IN =
  'min-h-11 min-w-0 rounded-md border border-ink bg-ink px-5 font-medium break-words text-paper';

/** The chat's cursor from the address when it is one of the chat's (a message's ID); anything else is dropped. */
function chatCursor(raw: string | string[] | undefined): string | undefined {
  if (typeof raw !== 'string' || raw === '') return undefined;
  try {
    decodeCursor('last', raw);
    return raw;
  } catch (error) {
    if (error instanceof CursorError) return undefined;
    throw error;
  }
}

/**
 * The reader agent (/sandbox/social/reader; docs/social/r12-design.md, section 4.4): the signed-in reader's day (the
 * messages left, or the pause), Hrizzup's day of reader-agent neurons, the chat with their reader agent, and their
 * reading profile, which they can edit by hand. Signed out, a link to sign in and come back. Plain stock components,
 * like every sandbox page; the real screens come from the design chat. Every word of the chat is shown as plain text,
 * never markdown or HTML (React escapes it), and nothing here runs the AI except the one send, in the form's action.
 */
export default async function ReaderAgent({ searchParams }: Props) {
  sandboxOnly();
  const who = await viewer();
  if (!who.signedIn) {
    return (
      <>
        <h1 className="text-3xl font-semibold">Reader agent</h1>
        <p className="mt-2 max-w-2xl text-muted">
          Sign in to tell your reader agent what you want to read, and to see and edit your reading
          profile.
        </p>
        <Link
          href={SIGN_IN_PATH}
          prefetch={false}
          className={`${SIGN_IN} mt-6 inline-flex items-center justify-center no-underline`}
        >
          Sign in to meet your reader agent
        </Link>
      </>
    );
  }

  const query = await searchParams;
  const cursor = chatCursor(query.chat);
  const [state, chat] = await Promise.all([
    serverApi.reader.get(),
    serverApi.reader.chat.list({ ...(cursor ? { cursor } : {}), limit: CHAT_PAGE }),
  ]);
  const { usage, allowance } = state;
  const paused = usage.pausedUntil !== null;
  const out = usage.messagesLeftToday === 0;
  const today = paused
    ? 'Chat pauses until 05:30 IST: your feed keeps working'
    : out
      ? "You've used today's messages: chat opens again at 05:30 IST"
      : `${usage.messagesLeftToday} of ${usage.dailyMessages} messages left today`;

  return (
    <>
      <h1 className="text-3xl font-semibold">Reader agent</h1>
      <p className="mt-2 max-w-2xl text-muted">
        Tell your reader agent what you want to read. It keeps your reading profile, and plain code
        builds your For You from it. It never posts.
      </p>
      <p className="mt-3">
        <Link
          href={FOR_YOU_PATH}
          prefetch={false}
          className="inline-flex min-h-11 items-center underline"
        >
          Your For You
        </Link>
      </p>

      <p className="mt-4 min-w-0 break-words" data-testid="reader-today">
        {today}
      </p>
      <p className="mt-1 min-w-0 text-sm break-words text-muted" data-testid="reader-allowance">
        Hrizzup's reader agents today: {allowance.neuronsUsed} of {allowance.dailyNeurons} neurons
        used
      </p>

      <ChatForm blocked={paused || out ? today : null} />

      <h2 className="mt-8 text-xl font-semibold">Your messages</h2>
      {chat.messages.length === 0 ? (
        <p className="mt-2 text-muted" data-testid="reader-chat-empty">
          No messages yet. Say what you want more of, less of, and the formats you like.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-line border-y border-line" data-testid="reader-chat">
          {chat.messages.map((message) => (
            <li
              key={message.id}
              className="min-w-0 py-3"
              data-testid="reader-message"
              data-author={message.author}
            >
              <p className="text-sm text-muted">
                {message.author === 'reader' ? 'You' : 'Your reader agent'} ·{' '}
                {whenText(message.createdAt)}
                {message.neurons !== null ? ` · used ${message.neurons} neurons` : ''}
              </p>
              <p className="mt-1 whitespace-pre-wrap wrap-anywhere">{message.body}</p>
            </li>
          ))}
        </ul>
      )}
      {cursor || chat.next ? (
        <p className="mt-4 flex flex-wrap gap-x-6">
          {cursor ? (
            <Link
              href={READER_PATH}
              prefetch={false}
              className="inline-flex min-h-11 items-center underline"
            >
              Newest messages
            </Link>
          ) : null}
          {chat.next ? (
            <Link
              href={`${READER_PATH}?chat=${chat.next}`}
              prefetch={false}
              className="inline-flex min-h-11 items-center underline"
            >
              Earlier messages
            </Link>
          ) : null}
        </p>
      ) : null}

      <ProfileForm profile={state.profile} />
    </>
  );
}
