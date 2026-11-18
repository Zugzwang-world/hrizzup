import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * The post page's two forms as the server draws them first (docs/social/media-design.md, section 9.1): every field
 * labelled and in a one-column grid (the page fits every size), the agent and the story selected only when the page
 * says so (never a first one by default when the address names none), no file field for a text post, only the formats
 * of the kind, and Hrizzup's own form starting with its handle, name and bio. The browser's part, Preview and Post, is
 * `console-post-flow.test.ts`'s.
 */

vi.mock('./actions.ts', () => ({
  startUpload: vi.fn(),
  finishUpload: vi.fn(),
  postAction: vi.fn(),
  makeAgentAction: vi.fn(),
}));

const { PostForm } = await import('./post-form.tsx');
const { HRIZZUP, MakeHrizzupForm } = await import('./make-form.tsx');

const RULES = {
  types: {
    image: ['image/jpeg', 'image/png', 'image/webp'],
    video: ['video/mp4'],
    audio: ['audio/mp4', 'audio/mpeg'],
  },
  maxBytes: { image: 10_485_760, video: 104_857_600, audio: 20_971_520 },
} as const;

const props = {
  agents: [
    { id: 'a1', handle: 'hrizzup', name: 'Hrizzup' },
    { id: 'a2', handle: 'hj_run', name: 'House journey' },
  ],
  agentId: null as string | null,
  stories: [
    { id: 's1', label: 'A story' },
    { id: 's2', label: 'A test story (test, unlisted)' },
  ],
  storyId: null as string | null,
  formats: [
    { code: 'meme', name: 'Meme', kinds: ['image'] },
    { code: 'note', name: 'Note', kinds: ['text'] },
    { code: 'reel', name: 'Reel', kinds: ['video'] },
  ],
  rules: RULES,
};

const render = (change: Partial<typeof props> = {}) =>
  renderToStaticMarkup(createElement(PostForm, { ...props, ...change }));

/** The tag of the option with this value, as React writes it. */
const option = (markup: string, value: string) =>
  new RegExp(`<option[^>]*value="${value}"[^>]*>`).exec(markup)?.[0] ?? '';

describe('the post form', () => {
  it('has every field of a text post, each with a label of its own', () => {
    const markup = render();
    for (const [id, label] of [
      ['post-agent', 'As'],
      ['post-story', 'Story'],
      ['post-kind', 'Kind'],
      ['post-format', 'Format'],
      ['post-body', 'Text'],
      ['post-sources', 'Sources'],
    ] as const) {
      expect(markup, id).toContain(`<label for="${id}" class="font-medium">${label}</label>`);
      expect(markup, id).toContain(`id="${id}"`);
    }
    expect(markup).toContain('>Preview</button>');
    expect(markup).toContain('data-testid="post-form"');
  });

  it('draws its fields in one column on a phone, and keeps every control inside its box', () => {
    const markup = render();
    expect(markup).toContain('grid grid-cols-1');
    expect(markup).not.toContain('sr-only');
    expect(markup).not.toMatch(/ style="[^"]*width/);
    // The stock field: full width, allowed to shrink.
    expect(markup).toContain('mt-1 block w-full min-w-0 rounded-md border border-line');
  });

  it('has its Preview button off in the server’s markup, so a click before the form has mounted is not the browser’s own submit', () => {
    expect(render()).toMatch(
      /<button type="submit" disabled=""[^>]*data-testid="post-preview-button"/,
    );
  });

  it('has no file, still image, description or transcript field for a text post, and no Post button before a Preview', () => {
    const markup = render();
    expect(markup).not.toContain('type="file"');
    expect(markup).not.toContain('post-still');
    expect(markup).not.toContain('post-transcript');
    expect(markup).not.toContain('post-description');
    expect(markup).not.toContain('post-send-button');
  });

  it('lists the four kinds, starting at text', () => {
    const markup = render();
    for (const kind of ['text', 'image', 'video', 'audio']) {
      expect(option(markup, kind), kind).not.toBe('');
    }
    expect(option(markup, 'text')).toContain('selected');
  });

  it('offers the formats of the kind only, and none by default', () => {
    const markup = render();
    expect(option(markup, '')).not.toBe('');
    expect(option(markup, 'note')).not.toBe('');
    expect(option(markup, 'meme')).toBe('');
    expect(option(markup, 'reel')).toBe('');
  });

  it('starts with no agent and no story chosen when the page selected none, never the first', () => {
    const markup = render();
    expect(markup).toContain('Choose an agent…');
    expect(markup).toContain('Choose a story…');
    expect(option(markup, 'a1')).not.toContain('selected');
    expect(option(markup, 's1')).not.toContain('selected');
    // The empty choices are the ones chosen.
    expect(option(markup, '')).toContain('selected');
  });

  it('selects the agent and the story the page selected, and only those', () => {
    const markup = render({ agentId: 'a2', storyId: 's2' });
    expect(option(markup, 'a2')).toContain('selected');
    expect(option(markup, 'a1')).not.toContain('selected');
    expect(option(markup, 's2')).toContain('selected');
    expect(option(markup, 's1')).not.toContain('selected');
  });

  it('shows each agent by name and handle and each story by its label, test marks included', () => {
    const markup = render();
    expect(markup).toContain('House journey (@hj_run)');
    expect(markup).toContain('A test story (test, unlisted)');
  });
});

describe('the fields of each kind', () => {
  const kinds = (change: Record<string, unknown>) => render(change as Partial<typeof props>);

  it('are a file and a description for an image, with no still image and no transcript', () => {
    const markup = kinds({ initialKind: 'image' });
    expect(markup).toContain('id="post-file"');
    expect(markup).toContain('type="file"');
    expect(markup).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(markup).toContain('id="post-description"');
    expect(markup).not.toContain('post-still');
    expect(markup).not.toContain('post-transcript');
    // The caption's box is shorter than a text post's, and its format list is the image formats.
    expect(markup).toContain('maxLength="1000"');
    expect(option(markup, 'meme')).not.toBe('');
    expect(option(markup, 'note')).toBe('');
  });

  it('are a file, a still image and a required transcript for a video and for an audio, and no description', () => {
    for (const kind of ['video', 'audio']) {
      const markup = kinds({ initialKind: kind });
      expect(markup, kind).toContain('id="post-file"');
      expect(markup, kind).toContain('id="post-still"');
      expect(markup, kind).toContain('accept="image/jpeg,image/png,image/webp"');
      expect(markup, kind).toContain('id="post-transcript"');
      expect(markup, kind).toContain('Required: the words it says');
      expect(markup, kind).not.toContain('post-description');
    }
    expect(kinds({ initialKind: 'video' })).toContain('accept="video/mp4"');
    expect(kinds({ initialKind: 'audio' })).toContain('accept="audio/mp4,audio/mpeg,.m4a,.mp3"');
  });
});

describe('Hrizzup’s own form', () => {
  it('starts with the handle hrizzup, the name Hrizzup and the bio of the design, each labelled', () => {
    const markup = renderToStaticMarkup(createElement(MakeHrizzupForm));
    expect(HRIZZUP).toEqual({
      handle: 'hrizzup',
      name: 'Hrizzup',
      bio: "Hrizzup's own agent: posts written by Hrizzup's team in the console.",
    });
    expect(markup).toContain('value="hrizzup"');
    expect(markup).toContain('value="Hrizzup"');
    // The bio is a box that wraps (a long line in a one-line field is cut off on a phone).
    expect(markup).toContain('<textarea id="make-bio"');
    expect(markup).toContain(
      'Hrizzup&#x27;s own agent: posts written by Hrizzup&#x27;s team in the console.</textarea>',
    );
    for (const [id, label] of [
      ['make-handle', 'Handle'],
      ['make-name', 'Name'],
      ['make-bio', 'Bio'],
    ] as const) {
      expect(markup, id).toContain(`<label for="${id}" class="font-medium">${label}</label>`);
    }
    expect(markup).toContain('>Make Hrizzup</button>');
    expect(markup).toContain('grid grid-cols-1');
    // The handle may be changed (hrizzup may be taken): it is a plain field, not read-only or hidden.
    expect(markup).not.toMatch(/name="handle"[^>]*(readonly|disabled)/);
  });
});
