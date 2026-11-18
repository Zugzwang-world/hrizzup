import { ORPCError } from '@orpc/server';
import { rgbaToThumbHash } from 'thumbhash';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { START } from '@/lib/social/console-state.ts';
import { BOARD_FIXTURE_STORY, MEDIA_FIXTURE_STORY } from '@/lib/social/fixture-ids.ts';

/**
 * The console's "Post as Hrizzup" page's actions (docs/social/media-design.md, section 9.2 and 9.3): to anyone but
 * an admin each answers "not found" before it reads anything sent; for an admin each sends one call with exactly what
 * the page gave it, answers every refusal in words (never thrown, so what was typed is kept), and a post on a story
 * the checks keep is refused in words before any call. Who is an admin, and the typed API's answers, are stood in for
 * here; the calls themselves are tested with the API and the database.
 */

const consoleAdmin = vi.fn();
const calls = {
  create: vi.fn(),
  done: vi.fn(),
  post: vi.fn(),
  make: vi.fn(),
};

vi.mock('@/lib/console.ts', () => ({ consoleAdmin: () => consoleAdmin() }));
vi.mock('@/lib/api/server.ts', () => ({
  serverApi: {
    admin: {
      social: {
        uploads: { create: calls.create, done: calls.done },
        house: { post: calls.post, make: calls.make },
      },
    },
  },
}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

const { finishUpload, makeAgentAction, postAction, startUpload } = await import('./actions.ts');

const AGENT = '019a6b3c-0001-7000-8000-0000000000a1';
const STORY = '019a6b3c-0001-7000-8000-000000000001';
const MEDIA = '019a6b3c-0001-7000-8000-0000000000b1';
const STILL = '019a6b3c-0001-7000-8000-0000000000b2';
const REQUEST = '3f1b7c36-5a2e-4f6e-9d3a-1c2b3d4e5f60';

const refusal = (code: string, status: number, message: string, data?: unknown) =>
  new ORPCError(code, { status, message, ...(data === undefined ? {} : { data }) });

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

/** A ThumbHash of a 16 by 12 gradient, in base64: one `placeholderDataUrl` turns into a data URL. */
function hash(): string {
  const [w, h] = [16, 12];
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = (i * 7) % 256;
    rgba[i * 4 + 1] = (i * 3) % 256;
    rgba[i * 4 + 2] = 200 - (i % w) * 8;
    rgba[i * 4 + 3] = 255;
  }
  return Buffer.from(rgbaToThumbHash(w, h, rgba)).toString('base64');
}

const startInput = {
  requestId: REQUEST,
  agentId: AGENT,
  storyId: STORY,
  kind: 'image' as const,
  contentType: 'image/png',
  bytes: 1234,
};
const finishInput = { requestId: REQUEST, mediaId: MEDIA, what: 'The file' };
const postInput = {
  requestId: REQUEST,
  agentId: AGENT,
  storyId: STORY,
  kind: 'text' as const,
  body: 'A line of words',
  sources: [] as string[],
  format: null,
  mediaId: null,
};

beforeEach(() => {
  consoleAdmin.mockResolvedValue({ account: 'admin', pool: {} });
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('the post page’s actions, to anyone but an admin', () => {
  it('answer "not found" before reading anything, and make no call', async () => {
    consoleAdmin.mockResolvedValue(null);
    await expect(startUpload(startInput)).rejects.toThrow('NOT_FOUND');
    await expect(finishUpload(finishInput)).rejects.toThrow('NOT_FOUND');
    await expect(postAction(postInput)).rejects.toThrow('NOT_FOUND');
    await expect(
      makeAgentAction(START, form({ handle: 'hrizzup', name: 'Hrizzup' })),
    ).rejects.toThrow('NOT_FOUND');
    for (const call of Object.values(calls)) expect(call).not.toHaveBeenCalled();
  });
});

describe('asking for an upload link', () => {
  it('sends the console’s purpose with exactly what was given, and answers the link with the type it was signed for', async () => {
    calls.create.mockResolvedValue({
      media: { id: MEDIA, kind: 'image', state: 'waiting' },
      uploadUrl: 'https://uploads.example.test/key?X-Amz-Signature=abc',
      headers: { 'Content-Type': 'image/png', 'Content-Length': '1234' },
      expiresAt: '2026-11-19T12:10:00.000Z',
    });
    const answer = await startUpload(startInput);
    expect(calls.create).toHaveBeenCalledWith({
      requestId: REQUEST,
      purpose: 'console',
      agentId: AGENT,
      kind: 'image',
      contentType: 'image/png',
      bytes: 1234,
    });
    expect(answer).toEqual({
      ok: true,
      mediaId: MEDIA,
      uploadUrl: 'https://uploads.example.test/key?X-Amz-Signature=abc',
      contentType: 'image/png',
    });
  });

  it('refuses a story the checks keep in words, before any call', async () => {
    for (const story of [MEDIA_FIXTURE_STORY, BOARD_FIXTURE_STORY]) {
      const answer = await startUpload({ ...startInput, storyId: story });
      expect(answer).toEqual({
        ok: false,
        error: 'That story is kept for the checks: nothing is posted on it.',
        retry: false,
      });
    }
    expect(calls.create).not.toHaveBeenCalled();
  });

  it('answers each refusal in words, never thrown, saying whether the same again may work', async () => {
    calls.create.mockRejectedValueOnce(
      refusal('FORBIDDEN', 403, 'This agent is retired', { reason: 'retired' }),
    );
    expect(await startUpload(startInput)).toEqual({
      ok: false,
      error:
        "This agent is retired, so it can't post or take uploads any more: a new one needs another handle.",
      retry: false,
    });
    calls.create.mockRejectedValueOnce(
      refusal('TOO_MANY_REQUESTS', 429, 'Too many', {
        reason: 'uploads_per_day',
        retryAfterSeconds: 3600,
      }),
    );
    expect(await startUpload(startInput)).toMatchObject({
      ok: false,
      error: 'This agent has used its uploads for today: it can send more in about 60 minutes.',
    });
    calls.create.mockRejectedValueOnce(
      refusal('SERVICE_UNAVAILABLE', 503, 'Uploads are not set up here'),
    );
    expect(await startUpload(startInput)).toMatchObject({ ok: false, retry: true });
  });

  it('is "not found" when the call is no call here, and throws what is a fault of ours', async () => {
    calls.create.mockRejectedValueOnce(refusal('NOT_FOUND', 404, 'No such call'));
    await expect(startUpload(startInput)).rejects.toThrow('NOT_FOUND');
    calls.create.mockRejectedValueOnce(new TypeError('a bug'));
    await expect(startUpload(startInput)).rejects.toThrow('a bug');
  });
});

describe('saying an upload is done', () => {
  const picture = {
    id: MEDIA,
    kind: 'image',
    url: 'https://media.example.test/x.png',
    width: 320,
    height: 180,
    durationSeconds: null,
    still: null,
    placeholder: null,
    description: 'A test picture',
  };

  it('sends an image’s description alone, and answers the ready media with no placeholder when it has none', async () => {
    calls.done.mockResolvedValue(picture);
    const answer = await finishUpload({ ...finishInput, description: 'A test picture' });
    expect(calls.done).toHaveBeenCalledWith({
      id: MEDIA,
      requestId: REQUEST,
      description: 'A test picture',
    });
    expect(answer).toEqual({ ok: true, media: picture, placeholder: null, stillPlaceholder: null });
  });

  it('sends a video’s transcript and still image, and answers the data URLs of both pictures', async () => {
    const video = {
      ...picture,
      kind: 'video',
      durationSeconds: 5,
      description: null,
      placeholder: hash(),
      still: {
        url: 'https://media.example.test/s.png',
        width: 320,
        height: 180,
        placeholder: hash(),
        description: null,
      },
    };
    calls.done.mockResolvedValue(video);
    const answer = await finishUpload({
      ...finishInput,
      transcript: 'The words it says',
      stillMediaId: STILL,
    });
    expect(calls.done).toHaveBeenCalledWith({
      id: MEDIA,
      requestId: REQUEST,
      transcript: 'The words it says',
      stillMediaId: STILL,
    });
    expect(answer.ok && answer.placeholder).toMatch(/^data:image\/png;base64,/);
    expect(answer.ok && answer.stillPlaceholder).toMatch(/^data:image\/png;base64,/);
  });

  it('answers a refused file in its own words for the file in question, and a check still running as one to try again', async () => {
    calls.done.mockRejectedValueOnce(
      refusal('REFUSED', 422, 'Animated images are not taken', { reason: 'media_refused' }),
    );
    expect(await finishUpload({ ...finishInput, what: 'The still image' })).toEqual({
      ok: false,
      error: 'The still image was refused: Animated images are not taken.',
      retry: false,
    });
    calls.done.mockRejectedValueOnce(
      refusal('CONFLICT', 409, 'Checking', { reason: 'media_checking' }),
    );
    expect(await finishUpload(finishInput)).toMatchObject({ ok: false, retry: true });
    calls.done.mockRejectedValueOnce(
      refusal('REFUSED', 422, 'Needs a transcript', { reason: 'transcript_needed' }),
    );
    expect(await finishUpload(finishInput)).toMatchObject({
      ok: false,
      error: 'A video or audio needs its transcript: type the words it says.',
      retry: false,
    });
  });
});

describe('posting', () => {
  const card = {
    id: '019a6b3c-0001-7000-8000-0000000000c1',
    storyId: STORY,
    agent: {
      id: AGENT,
      handle: 'hrizzup',
      name: 'Hrizzup',
      picture: null,
      house: true,
      ownerName: null,
    },
    kind: 'text',
    body: 'A line of words',
    sources: [],
    format: null,
    afterUpdateId: null,
    media: null,
    createdAt: '2026-11-19T12:00:00.000Z',
    counts: { replies: 0, upvotes: 0, views: 0, uniqueViews: 0 },
  };

  it('sends a text post with only what it has, and answers its card', async () => {
    calls.post.mockResolvedValue(card);
    const answer = await postAction(postInput);
    expect(calls.post).toHaveBeenCalledWith({
      requestId: REQUEST,
      agentId: AGENT,
      storyId: STORY,
      kind: 'text',
      body: 'A line of words',
    });
    expect(answer).toEqual({ ok: true, card, placeholder: null, stillPlaceholder: null });
  });

  it('sends sources, the format and the media when it has them, and answers the card’s data URLs', async () => {
    const media = {
      id: MEDIA,
      kind: 'image',
      url: 'https://media.example.test/x.png',
      width: 320,
      height: 180,
      durationSeconds: null,
      still: null,
      placeholder: hash(),
      description: null,
    };
    calls.post.mockResolvedValue({ ...card, kind: 'image', media, format: 'meme' });
    const answer = await postAction({
      ...postInput,
      kind: 'image',
      sources: ['https://example.com/a', 'https://example.com/b'],
      format: 'meme',
      mediaId: MEDIA,
    });
    expect(calls.post).toHaveBeenCalledWith({
      requestId: REQUEST,
      agentId: AGENT,
      storyId: STORY,
      kind: 'image',
      body: 'A line of words',
      sources: ['https://example.com/a', 'https://example.com/b'],
      format: 'meme',
      mediaId: MEDIA,
    });
    expect(answer.ok && answer.placeholder).toMatch(/^data:image\/png;base64,/);
  });

  it('refuses a story the checks keep in words under the story, before any call', async () => {
    for (const story of [MEDIA_FIXTURE_STORY, BOARD_FIXTURE_STORY.toUpperCase()]) {
      const answer = await postAction({ ...postInput, storyId: story });
      expect(answer).toEqual({
        ok: false,
        error: 'That story is kept for the checks: nothing is posted on it.',
        problems: { storyId: 'That story is kept for the checks: nothing is posted on it.' },
      });
    }
    expect(calls.post).not.toHaveBeenCalled();
  });

  it('answers each refusal in words with a problem under each field it names', async () => {
    calls.post.mockRejectedValueOnce(
      refusal('REFUSED', 422, 'Withdrawn', { reason: 'story_not_live' }),
    );
    expect(await postAction(postInput)).toEqual({
      ok: false,
      error: 'That story was withdrawn, so nothing can be posted on it: choose another.',
      problems: {},
    });
    calls.post.mockRejectedValueOnce(
      refusal('TOO_MANY_REQUESTS', 429, 'Too many', {
        reason: 'posts_per_day',
        retryAfterSeconds: 7200,
      }),
    );
    expect(await postAction(postInput)).toMatchObject({
      ok: false,
      error: 'This agent has posted as much as it may today: it can post again in about 2 hours.',
    });
    calls.post.mockRejectedValueOnce(
      refusal('BAD_REQUEST', 400, 'Bad', {
        issues: [{ path: 'body', message: 'At most 5000 characters' }],
      }),
    );
    expect(await postAction(postInput)).toEqual({
      ok: false,
      error: 'Not saved: see the lines under the fields.',
      problems: { body: 'At most 5000 characters.' },
    });
  });
});

describe('making Hrizzup', () => {
  it('sends the handle, name and bio as typed, listed for good, and opens the page with the new agent selected', async () => {
    calls.make.mockResolvedValue({ id: AGENT });
    await expect(
      makeAgentAction(
        START,
        form({ handle: ' hrizzup ', name: 'Hrizzup', bio: "Hrizzup's own agent: posts." }),
      ),
    ).rejects.toThrow(`REDIRECT /console/social/post?as=${AGENT}`);
    expect(calls.make).toHaveBeenCalledTimes(1);
    const sent = calls.make.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(sent).toMatchObject({
      handle: 'hrizzup',
      name: 'Hrizzup',
      bio: "Hrizzup's own agent: posts.",
      listed: true,
    });
    expect(typeof sent.requestId).toBe('string');
  });

  it('sends no bio when it is blank', async () => {
    calls.make.mockResolvedValue({ id: AGENT });
    await expect(
      makeAgentAction(START, form({ handle: 'hrizzup', name: 'Hrizzup', bio: ' ' })),
    ).rejects.toThrow('REDIRECT');
    expect(calls.make.mock.calls[0]?.[0]).not.toHaveProperty('bio');
  });

  it('tells a taken handle under the handle and keeps what was typed', async () => {
    calls.make.mockRejectedValueOnce(refusal('CONFLICT', 409, 'taken', { reason: 'handle_taken' }));
    const typed = { handle: 'hrizzup', name: 'Hrizzup', bio: 'A bio' };
    const state = await makeAgentAction(START, form(typed));
    expect(state).toEqual({
      error: 'Not made: see the line under the handle.',
      problems: { handle: 'That handle is taken: type another one.' },
      values: typed,
    });
  });

  it('is "not found" when the call is no call here', async () => {
    calls.make.mockRejectedValueOnce(refusal('NOT_FOUND', 404, 'No such call'));
    await expect(
      makeAgentAction(START, form({ handle: 'hrizzup', name: 'Hrizzup' })),
    ).rejects.toThrow('NOT_FOUND');
  });
});
