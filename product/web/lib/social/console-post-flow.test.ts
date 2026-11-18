import { describe, expect, it, vi } from 'vitest';
import {
  type Fields,
  type FileLike,
  type FlowDeps,
  type Memory,
  NOT_PREVIEWED,
  postedPost,
  previewOf,
  problemsOf,
  Stop,
  sendFile,
} from './console-post-flow.ts';
import type { FinishAnswer, PostAnswer, ReadyMediaShape, UploadRules } from './console-upload.ts';

/**
 * What the post page does when Preview and Post are pressed (docs/social/media-design.md, section 9.2 and 10), with
 * stand-ins for the server's actions and the browser's `PUT`: the checks before anything is sent, the still image first
 * and its ID sent with the file's, a file sent to its link as it was signed for, nothing sent twice by a second Preview,
 * words that change making a new upload (a ready media's words never change), and each failure remembered or forgotten
 * as it should be.
 */

const RULES: UploadRules = {
  types: {
    image: ['image/jpeg', 'image/png', 'image/webp'],
    video: ['video/mp4'],
    audio: ['audio/mp4', 'audio/mpeg'],
  },
  maxBytes: { image: 10_485_760, video: 104_857_600, audio: 20_971_520 },
};

const file = (name: string, type: string, size = 5000, lastModified = 1): FileLike => ({
  name,
  type,
  size,
  lastModified,
});
const agent = { id: 'agent-1', handle: 'hrizzup', name: 'Hrizzup' };

function fields(over: Partial<Fields<FileLike>> = {}): Fields<FileLike> {
  return {
    agent,
    storyId: 'story-1',
    kind: 'text',
    body: 'A line of words',
    format: '',
    sources: [],
    description: '',
    transcript: '',
    file: null,
    still: null,
    ...over,
  };
}

const mediaOf = (id: string, kind: 'image' | 'video' | 'audio'): ReadyMediaShape => ({
  id,
  kind,
  url: `https://media.example.test/${id}`,
  width: kind === 'audio' ? null : 320,
  height: kind === 'audio' ? null : 180,
  durationSeconds: kind === 'image' ? null : 5,
  still: null,
  placeholder: null,
  description: null,
});

/** Stand-ins that number each upload and answer as the server does, recording every call. */
function stand() {
  let ids = 0;
  let uploads = 0;
  const log: string[] = [];
  const deps = {
    startUpload: vi.fn(async (input: { kind: string; contentType: string; requestId: string }) => {
      uploads += 1;
      log.push(`link ${input.kind}`);
      return {
        ok: true as const,
        mediaId: `media-${uploads}`,
        uploadUrl: `https://uploads.example.test/${uploads}`,
        contentType: `${input.contentType}`,
      };
    }),
    finishUpload: vi.fn(
      async (input: {
        requestId: string;
        mediaId: string;
        what: string;
      }): Promise<FinishAnswer> => {
        log.push(`done ${input.mediaId}`);
        return {
          ok: true,
          media: mediaOf(input.mediaId, input.what === 'The still image' ? 'image' : 'video'),
          placeholder: null,
          stillPlaceholder: null,
        };
      },
    ),
    put: vi.fn(async (url: string, contentType: string) => {
      log.push(`put ${url} as ${contentType}`);
      return 200;
    }),
    newId: vi.fn(() => `id-${++ids}`),
    progress: vi.fn(),
  } satisfies FlowDeps<FileLike>;
  return { deps, log, memory: new Map() as Memory };
}

describe('the checks made before anything is sent', () => {
  it('find nothing wrong with a text post, an image with its file, and a video with its still and transcript', () => {
    expect(problemsOf(fields(), RULES)).toEqual({});
    expect(problemsOf(fields({ kind: 'image', file: file('a.png', 'image/png') }), RULES)).toEqual(
      {},
    );
    expect(
      problemsOf(
        fields({
          kind: 'video',
          file: file('clip.mp4', 'video/mp4'),
          still: file('s.png', 'image/png'),
          transcript: 'The words',
        }),
        RULES,
      ),
    ).toEqual({});
  });

  it('name each field that is wrong, in words', () => {
    expect(problemsOf(fields({ agent: undefined, storyId: '', body: '' }), RULES)).toEqual({
      agentId: 'Choose who posts.',
      storyId: 'Choose a story.',
      body: 'Write the post.',
    });
    expect(problemsOf(fields({ kind: 'image' }), RULES)).toEqual({
      file: 'The file is needed: choose one.',
    });
    expect(
      problemsOf(
        fields({ kind: 'audio', file: file('a.mp3', 'audio/mpeg'), still: null, transcript: '' }),
        RULES,
      ),
    ).toEqual({
      still: 'The still image is needed: choose one.',
      transcript: 'A video or audio needs its transcript: type the words it says.',
    });
    expect(
      problemsOf(
        fields({
          kind: 'video',
          file: file('a.mov', 'video/quicktime'),
          still: file('s.gif', 'image/gif'),
          transcript: 'w',
        }),
        RULES,
      ),
    ).toEqual({
      file: 'The file must be an MP4 video: choose another.',
      still: 'The still image must be a JPEG, PNG or WebP picture: choose another.',
    });
  });

  it('says what a stopped Preview says above the fields', () => {
    expect(NOT_PREVIEWED).toBe('Not previewed: see the lines under the fields.');
  });
});

describe('a Preview', () => {
  it('sends nothing for a text post and shows it with no media, and the post it sends later is exactly that', async () => {
    const { deps, memory, log } = stand();
    const shown = await previewOf(deps, memory, RULES, {
      ...fields({ body: 'Words', format: 'meme', sources: ['https://example.com/a'] }),
      agent,
    });
    expect(log).toEqual([]);
    expect(shown.post).toMatchObject({
      kind: 'text',
      body: 'Words',
      format: 'meme',
      sources: ['https://example.com/a'],
      media: null,
      transcript: null,
      postedAt: null,
      agent: { handle: 'hrizzup', name: 'Hrizzup', house: true, ownerName: null },
    });
    expect(shown.snapshot).toEqual({
      requestId: 'id-1',
      agentId: 'agent-1',
      storyId: 'story-1',
      kind: 'text',
      body: 'Words',
      sources: ['https://example.com/a'],
      format: 'meme',
      mediaId: null,
      transcript: null,
    });
  });

  it('sends an image as the link was signed for, then says it done with its description', async () => {
    const { deps, memory, log } = stand();
    const shown = await previewOf(deps, memory, RULES, {
      ...fields({
        kind: 'image',
        file: file('photo.PNG', ''),
        description: 'A test picture',
      }),
      agent,
    });
    // The file's own type was empty: its ending named it, and the link answered the type it was signed for.
    expect(deps.startUpload).toHaveBeenCalledWith({
      requestId: 'id-1',
      agentId: 'agent-1',
      storyId: 'story-1',
      kind: 'image',
      contentType: 'image/png',
      bytes: 5000,
    });
    expect(log).toEqual([
      'link image',
      'put https://uploads.example.test/1 as image/png',
      'done media-1',
    ]);
    expect(deps.finishUpload).toHaveBeenCalledWith({
      requestId: 'id-2',
      mediaId: 'media-1',
      description: 'A test picture',
      what: 'The file',
    });
    expect(shown.snapshot.mediaId).toBe('media-1');
    expect(shown.post.media?.id).toBe('media-1');
  });

  it('sends a video’s still image first and its ID with the file’s, with the transcript', async () => {
    const { deps, memory, log } = stand();
    const shown = await previewOf(deps, memory, RULES, {
      ...fields({
        kind: 'video',
        file: file('clip.mp4', 'video/mp4', 90_000),
        still: file('still.png', 'image/png'),
        transcript: 'The words it says',
      }),
      agent,
    });
    expect(log).toEqual([
      'link image',
      'put https://uploads.example.test/1 as image/png',
      'done media-1',
      'link video',
      'put https://uploads.example.test/2 as video/mp4',
      'done media-2',
    ]);
    expect(deps.finishUpload).toHaveBeenLastCalledWith({
      requestId: expect.any(String),
      mediaId: 'media-2',
      transcript: 'The words it says',
      stillMediaId: 'media-1',
      what: 'The file',
    });
    // The still image is said done with nothing else.
    expect(deps.finishUpload).toHaveBeenNthCalledWith(1, {
      requestId: expect.any(String),
      mediaId: 'media-1',
      what: 'The still image',
    });
    expect(shown.snapshot).toMatchObject({
      kind: 'video',
      mediaId: 'media-2',
      transcript: 'The words it says',
    });
    expect(shown.post.transcript).toBe('The words it says');
  });

  it('sends nothing twice when the same Preview is pressed again', async () => {
    const { deps, memory } = stand();
    const input = {
      ...fields({ kind: 'image', file: file('a.png', 'image/png'), description: 'Same' }),
      agent,
    };
    const first = await previewOf(deps, memory, RULES, input);
    const second = await previewOf(deps, memory, RULES, input);
    expect(deps.startUpload).toHaveBeenCalledTimes(1);
    expect(deps.put).toHaveBeenCalledTimes(1);
    expect(deps.finishUpload).toHaveBeenCalledTimes(1);
    expect(second.snapshot.mediaId).toBe(first.snapshot.mediaId);
    // The post's own request ID is new each time: only the previewed post is posted.
    expect(second.snapshot.requestId).not.toBe(first.snapshot.requestId);
  });

  it('sends a new upload when the words, the agent or the file differ (a ready media’s words never change)', async () => {
    const { deps, memory } = stand();
    const base = fields({ kind: 'image', file: file('a.png', 'image/png'), description: 'One' });
    await previewOf(deps, memory, RULES, { ...base, agent });
    await previewOf(deps, memory, RULES, { ...base, description: 'Two', agent });
    await previewOf(deps, memory, RULES, { ...base, agent: { ...agent, id: 'agent-2' } });
    await previewOf(deps, memory, RULES, {
      ...base,
      file: file('a.png', 'image/png', 5000, 2),
      agent,
    });
    expect(deps.startUpload).toHaveBeenCalledTimes(4);
  });

  it('keeps a still image that is ready when the file fails, so the next Preview goes on where it stopped', async () => {
    const { deps, memory, log } = stand();
    const clip = {
      ...fields({
        kind: 'audio',
        file: file('talk.mp3', 'audio/mpeg'),
        still: file('s.png', 'image/png'),
        transcript: 'Words',
      }),
      agent,
    };
    deps.put.mockImplementationOnce(async (url: string, contentType: string) => {
      log.push(`put ${url} as ${contentType}`);
      return 200;
    });
    deps.put.mockImplementationOnce(async () => {
      throw new TypeError('network');
    });
    await expect(previewOf(deps, memory, RULES, clip)).rejects.toThrow(
      "The browser couldn't send the file to storage",
    );
    log.length = 0;
    deps.startUpload.mockClear();
    await previewOf(deps, memory, RULES, clip);
    // Only the audio is asked for again, with the same request ID, and the still image is not sent twice.
    expect(deps.startUpload).toHaveBeenCalledTimes(1);
    expect(deps.startUpload).toHaveBeenCalledWith(expect.objectContaining({ kind: 'audio' }));
    expect(log.filter((line) => line.startsWith('link'))).toEqual(['link audio']);
  });

  it('stops with words when storage refuses the file, and sends it to the same link again next time', async () => {
    const { deps, memory } = stand();
    deps.put.mockResolvedValueOnce(403);
    const input = { ...fields({ kind: 'image', file: file('a.png', 'image/png') }), agent };
    await expect(previewOf(deps, memory, RULES, input)).rejects.toThrow(
      'Storage refused the file (status 403): press Preview again.',
    );
    expect(deps.finishUpload).not.toHaveBeenCalled();
    const requestId = deps.startUpload.mock.calls[0]?.[0].requestId;
    await previewOf(deps, memory, RULES, input);
    // The link is asked for again with the same request ID (the answer is the same upload), then sent and said done.
    expect(deps.startUpload.mock.calls[1]?.[0].requestId).toBe(requestId);
    expect(deps.finishUpload).toHaveBeenCalledTimes(1);
  });

  it('forgets an upload the server refused for good, so the next Preview makes a new one, and keeps one that may work again', async () => {
    const { deps, memory } = stand();
    const input = { ...fields({ kind: 'image', file: file('a.png', 'image/png') }), agent };
    deps.finishUpload.mockResolvedValueOnce({
      ok: false,
      error: 'The file was refused: Animated.',
      retry: false,
    });
    await expect(previewOf(deps, memory, RULES, input)).rejects.toThrow(
      'The file was refused: Animated.',
    );
    expect(memory.size).toBe(0);
    await previewOf(deps, memory, RULES, input);
    expect(deps.startUpload).toHaveBeenCalledTimes(2);

    const again = stand();
    again.deps.finishUpload.mockResolvedValueOnce({
      ok: false,
      error: 'Still being checked.',
      retry: true,
    });
    await expect(previewOf(again.deps, again.memory, RULES, input)).rejects.toThrow(
      'Still being checked.',
    );
    expect(again.memory.size).toBe(1);
    await previewOf(again.deps, again.memory, RULES, input);
    // The file is not sent again, only said done again with the same request ID.
    expect(again.deps.startUpload).toHaveBeenCalledTimes(1);
    expect(again.deps.put).toHaveBeenCalledTimes(1);
    expect(again.deps.finishUpload).toHaveBeenCalledTimes(2);
    expect(again.deps.finishUpload.mock.calls[1]?.[0].requestId).toBe(
      again.deps.finishUpload.mock.calls[0]?.[0].requestId,
    );
  });

  it('stops with the server’s words when the link is refused, and forgets the file unless it may work again', async () => {
    const { deps, memory } = stand();
    deps.startUpload.mockResolvedValueOnce({
      ok: false,
      error: 'This agent is retired.',
      retry: false,
    } as never);
    const input = { ...fields({ kind: 'image', file: file('a.png', 'image/png') }), agent };
    await expect(previewOf(deps, memory, RULES, input)).rejects.toBeInstanceOf(Stop);
    expect(memory.size).toBe(0);
    expect(deps.put).not.toHaveBeenCalled();
  });

  it('refuses a file of a type the kind does not take without asking for a link', async () => {
    const { deps, memory } = stand();
    await expect(
      sendFile(
        deps,
        memory,
        RULES,
        { agentId: 'a', storyId: 's' },
        file('a.gif', 'image/gif'),
        'image',
        {},
        'The file',
      ),
    ).rejects.toThrow("The file isn't a type that is taken: choose another.");
    expect(deps.startUpload).not.toHaveBeenCalled();
  });
});

describe('what Post shows', () => {
  const answer = {
    ok: true,
    card: {
      id: 'post-1',
      storyId: 'story-1',
      agent: { id: 'agent-1', handle: 'hrizzup', name: 'Hrizzup', house: true, ownerName: null },
      kind: 'video',
      body: 'Words',
      sources: ['https://example.com/a'],
      format: 'reel',
      media: mediaOf('media-2', 'video'),
      createdAt: '2026-11-19T12:00:00.000Z',
    },
    placeholder: 'data:image/png;base64,AAAA',
    stillPlaceholder: null,
  } satisfies Extract<PostAnswer, { ok: true }>;

  it('is the card the desk holds, with the transcript the preview held (a card carries none)', () => {
    const shown = postedPost(answer, {
      requestId: 'r',
      agentId: 'agent-1',
      storyId: 'story-1',
      kind: 'video',
      body: 'Words',
      sources: [],
      format: null,
      mediaId: 'media-2',
      transcript: 'The words it says',
    });
    expect(shown).toMatchObject({
      kind: 'video',
      format: 'reel',
      body: 'Words',
      transcript: 'The words it says',
      postedAt: '2026-11-19T12:00:00.000Z',
      placeholder: 'data:image/png;base64,AAAA',
      media: { id: 'media-2' },
    });
  });
});
