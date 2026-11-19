import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The reader agent's page and the For You page (docs/social/r12-design.md, section 4.4), drawn with what they read stood
 * in for (who is signed in, the typed API, the sandbox's gate, and the forms, which are the browser's): the lines a
 * reader reads (the day's messages, the pause, Hrizzup's neurons), the chat as plain text newest first, paging by the
 * cursor in the address, and For You's note for a cursor of a build that has changed. Each page's states: signed out,
 * signed in, and the empty and refused ones.
 */

const viewerState = vi.hoisted(() => ({ signedIn: true }));
const reader = vi.hoisted(() => ({
  get: vi.fn(),
  forYou: vi.fn(),
  chat: { list: vi.fn() },
}));

vi.mock('@/lib/sandbox/data.ts', () => ({ viewer: async () => ({ ...viewerState }) }));
vi.mock('@/lib/sandbox/gate.ts', () => ({ sandboxOnly: () => undefined }));
vi.mock('@/lib/api/server.ts', () => ({ serverApi: { reader } }));
vi.mock('./actions.ts', () => ({
  sendMessage: vi.fn(),
  saveProfile: vi.fn(),
  showBoard: vi.fn(),
  showForYou: vi.fn(),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));

const { default: ReaderAgent } = await import('./page.tsx');
const { default: ForYou } = await import('./for-you/page.tsx');

const NEXT_CHAT = '019a7b10-0000-7000-8000-0000000000b0';

const state = (changes: Record<string, unknown> = {}, usage: Record<string, unknown> = {}) => ({
  profile: '# Reading profile\n\n## More of\n- AI\n\n## Less of\n\n## Formats',
  holdsSomething: true,
  usage: {
    messagesLeftToday: 19,
    messagesToday: 1,
    dailyMessages: 20,
    pausedUntil: null,
    resetsAt: '2026-11-19T00:00:00.000Z',
    ...usage,
  },
  allowance: { neuronsUsed: '5.365375', neuronsReserved: '0', dailyNeurons: '9000', calls: 1 },
  ...changes,
});
const message = (id: string, author: 'reader' | 'agent', body: string, neurons: string | null) => ({
  id,
  author,
  body,
  neurons,
  createdAt: '2026-11-18T08:20:03.000Z',
});
const tile = (id: string, title: string) => ({
  id,
  title,
  summary: 'A summary of the story.',
  categories: ['ai'],
  places: ['india'],
  createdAt: '2026-11-18T05:00:00.000Z',
  latestAt: '2026-11-18T06:00:00.000Z',
  latestHeadline: null,
  counts: { posts: 0, replies: 0, upvotes: 0, views: 0, uniqueViews: 0, pins: 0 },
  picture: null,
});

const draw = async (
  page: (props: never) => Promise<React.ReactNode>,
  query: Record<string, string> = {},
) =>
  renderToStaticMarkup(
    await (page as (props: unknown) => Promise<React.ReactElement>)({
      searchParams: Promise.resolve(query),
    }),
  );

beforeEach(() => {
  viewerState.signedIn = true;
  reader.get.mockReset();
  reader.forYou.mockReset();
  reader.chat.list.mockReset();
  reader.get.mockResolvedValue(state());
  reader.chat.list.mockResolvedValue({ messages: [], next: null });
  reader.forYou.mockResolvedValue({ stories: [], next: null });
});

describe('the reader agent page', () => {
  it('signed out: a link to sign in and come back, and nothing is read', async () => {
    viewerState.signedIn = false;
    const markup = await draw(ReaderAgent);
    expect(markup).toContain('Sign in to meet your reader agent');
    expect(markup).toContain('href="/sign-in-test?next=/sandbox/social/reader"');
    expect(reader.get).not.toHaveBeenCalled();
    expect(reader.chat.list).not.toHaveBeenCalled();
  });

  it('signed in: the day’s messages, Hrizzup’s neurons as exact text, the chat newest first as plain text, and the profile', async () => {
    reader.chat.list.mockResolvedValue({
      messages: [
        message(
          '019a7b10-0000-7000-8000-0000000000c2',
          'agent',
          'Done: <b>more</b> AI.',
          '5.365375',
        ),
        message(
          '019a7b10-0000-7000-8000-0000000000c1',
          'reader',
          'More AI <script>x</script>',
          null,
        ),
      ],
      next: NEXT_CHAT,
    });
    const markup = await draw(ReaderAgent);
    expect(markup).toContain('19 of 20 messages left today');
    expect(markup).toContain('Hrizzup&#x27;s reader agents today: 5.365375 of 9000 neurons used');
    // The newest first: the reply, then the reader's own message.
    expect(markup.indexOf('data-author="agent"')).toBeLessThan(
      markup.indexOf('data-author="reader"'),
    );
    expect(markup).toContain('Your reader agent');
    expect(markup).toContain('used 5.365375 neurons');
    expect(markup.match(/used [\d.]+ neurons/g)).toHaveLength(1);
    expect(markup).toContain('18 Nov 2026, 08:20 UTC');
    // Words are drawn as plain text: markup in a message is escaped, never drawn.
    expect(markup).toContain('Done: &lt;b&gt;more&lt;/b&gt; AI.');
    expect(markup).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(markup).not.toContain('<script>x');
    // Paging, the profile and the way to For You.
    expect(markup).toContain(`href="/sandbox/social/reader?chat=${NEXT_CHAT}"`);
    expect(markup).toContain('Earlier messages');
    expect(markup).not.toContain('Newest messages');
    expect(markup).toContain('data-testid="reader-profile-form"');
    expect(markup).toContain('href="/sandbox/social/reader/for-you"');
    expect(reader.chat.list).toHaveBeenCalledWith({ limit: 20 });
  });

  it('says when there are no messages yet', async () => {
    const markup = await draw(ReaderAgent);
    expect(markup).toContain('data-testid="reader-chat-empty"');
  });

  it('says chat pauses until 05:30 IST when Hrizzup’s day is spent, and the form can’t send', async () => {
    reader.get.mockResolvedValue(
      state({}, { pausedUntil: '2026-11-19T00:00:00.000Z', messagesLeftToday: 12 }),
    );
    const markup = await draw(ReaderAgent);
    expect(markup).toContain('Chat pauses until 05:30 IST: your feed keeps working');
    expect(markup).not.toContain('12 of 20 messages left today');
    expect(markup).toMatch(/<button type="submit"[^>]*\sdisabled=""[^>]*>Send<\/button>/);
  });

  it('says chat opens at 05:30 IST when the reader’s own messages are used, and the form can’t send', async () => {
    reader.get.mockResolvedValue(state({}, { messagesLeftToday: 0, messagesToday: 20 }));
    const markup = await draw(ReaderAgent);
    expect(markup).toContain(
      'You&#x27;ve used today&#x27;s messages: chat opens again at 05:30 IST',
    );
    expect(markup).toMatch(/<button type="submit"[^>]*\sdisabled=""[^>]*>Send<\/button>/);
  });

  it('opens an earlier page of the chat from the address, with a way back to the newest; a value that is no cursor is dropped', async () => {
    const markup = await draw(ReaderAgent, { chat: NEXT_CHAT });
    expect(reader.chat.list).toHaveBeenCalledWith({ cursor: NEXT_CHAT, limit: 20 });
    expect(markup).toContain('Newest messages');
    expect(markup).toContain('href="/sandbox/social/reader"');
    reader.chat.list.mockClear();
    const dropped = await draw(ReaderAgent, { chat: 'not-a-cursor' });
    expect(reader.chat.list).toHaveBeenCalledWith({ limit: 20 });
    expect(dropped).not.toContain('Newest messages');
  });
});

describe('the For You page', () => {
  it('signed out: a link to sign in, and nothing is read', async () => {
    viewerState.signedIn = false;
    const markup = await draw(ForYou);
    expect(markup).toContain('Sign in to get your own For You');
    expect(reader.forYou).not.toHaveBeenCalled();
    expect(reader.get).not.toHaveBeenCalled();
  });

  it('signed in with a profile that holds something: the line, the tab strip with For You current, R5’s tiles and a Next link', async () => {
    reader.forYou.mockResolvedValue({
      stories: [tile('019a7b10-0000-7000-8000-0000000000d1', 'First story title')],
      next: 'eyJiIjoiN2YzZTlhMjFjMDRiNWQ2OCIsIm8iOjF9',
    });
    const markup = await draw(ForYou);
    expect(reader.forYou).toHaveBeenCalledWith({ limit: 20 });
    expect(markup).toContain('Built from your reading profile');
    expect(markup).toMatch(/<span aria-current="true"[^>]*>For You<\/span>/);
    expect(markup).toMatch(/<button type="submit"[^>]*>Board<\/button>/);
    expect(markup).toContain('data-testid="story-tile"');
    expect(markup).toContain('First story title');
    expect(markup).toContain(
      'href="/sandbox/social/reader/for-you?cursor=eyJiIjoiN2YzZTlhMjFjMDRiNWQ2OCIsIm8iOjF9"',
    );
    expect(markup).not.toContain('First page');
  });

  it('says the profile is empty, and that this is the board’s Top, with a way to the reader agent', async () => {
    reader.get.mockResolvedValue(state({ holdsSomething: false }));
    reader.forYou.mockResolvedValue({
      stories: [tile('019a7b10-0000-7000-8000-0000000000d1', 'A story')],
      next: null,
    });
    const markup = await draw(ForYou);
    expect(markup).toContain('Your profile is empty, so this is the board&#x27;s Top: tell your');
    expect(markup).toContain('href="/sandbox/social/reader"');
  });

  it('says so when no story matches', async () => {
    const markup = await draw(ForYou);
    expect(markup).toContain('No stories match your profile right now');
  });

  it('pages from a cursor in the address: the call gets it, and a way back to the first page shows', async () => {
    const cursor = 'eyJiIjoiN2YzZTlhMjFjMDRiNWQ2OCIsIm8iOjF9';
    reader.forYou.mockResolvedValue({
      stories: [tile('019a7b10-0000-7000-8000-0000000000d2', 'Second page story')],
      next: null,
    });
    const markup = await draw(ForYou, { cursor });
    expect(reader.forYou).toHaveBeenCalledWith({ cursor, limit: 20 });
    expect(markup).toContain('First page');
    expect(markup).toContain('Second page story');
  });

  it('answers a cursor of a build that has changed with the first page and a note, never an error', async () => {
    const rebuilt = Object.assign(
      new Error('Your For You was rebuilt: start again from the first page'),
      {
        status: 400,
        data: {
          issues: [
            {
              path: 'cursor',
              message: 'Your For You was rebuilt: start again from the first page',
            },
          ],
        },
      },
    );
    reader.forYou.mockRejectedValueOnce(rebuilt);
    reader.forYou.mockResolvedValueOnce({
      stories: [tile('019a7b10-0000-7000-8000-0000000000d1', 'First story title')],
      next: null,
    });
    const markup = await draw(ForYou, { cursor: 'eyJiIjoiZmZmZmZmZmZmZmZmZmZmZiIsIm8iOjF9' });
    expect(reader.forYou).toHaveBeenNthCalledWith(1, {
      cursor: 'eyJiIjoiZmZmZmZmZmZmZmZmZmZmZiIsIm8iOjF9',
      limit: 20,
    });
    expect(reader.forYou).toHaveBeenNthCalledWith(2, { limit: 20 });
    expect(markup).toContain('Your For You was rebuilt: showing the first page');
    expect(markup).toContain('First story title');
    // It is the first page now: no way back to one.
    expect(markup).not.toContain('First page');
  });

  it('says another cursor’s refusal in its own words, and throws on any other failure', async () => {
    const refused = Object.assign(new Error('This cursor is not from this list'), {
      status: 400,
      data: { issues: [{ path: 'cursor', message: 'This cursor is not from this list' }] },
    });
    reader.forYou.mockRejectedValueOnce(refused);
    reader.forYou.mockResolvedValueOnce({ stories: [], next: null });
    const markup = await draw(ForYou, { cursor: 'x' });
    expect(markup).toContain(
      'That page link isn&#x27;t one of your For You pages: showing the first page',
    );
    reader.forYou.mockReset();
    reader.forYou.mockRejectedValue(new Error('the database is down'));
    await expect(draw(ForYou)).rejects.toThrow('the database is down');
    // A 400 that is not about the cursor is not turned into a note either.
    reader.forYou.mockReset();
    reader.forYou.mockRejectedValue(
      Object.assign(new Error('x'), { status: 400, data: { issues: [{ path: 'limit' }] } }),
    );
    await expect(draw(ForYou, { cursor: 'x' })).rejects.toThrow('x');
  });
});
