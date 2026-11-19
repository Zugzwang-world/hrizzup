import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FilePicker } from './file-picker.tsx';

/**
 * The post page's file field (docs/social/media-design.md, 9.1): the native input stays the control, only what is drawn
 * changes, because the browser's own "Choose File" and "No file chosen" can't wrap and are cut off by their box on a
 * narrow phone at 200% text. Its layout at every size, in both engines, is the screen check's and the journey's; here
 * its markup holds what keeps it a real, reachable control and keeps it wrapping.
 */

const render = () =>
  renderToStaticMarkup(
    createElement(FilePicker, {
      id: 'post-file',
      name: 'file',
      accept: 'video/mp4',
      hintId: 'post-file-hint',
    }),
  );

describe('the file field', () => {
  it('is a real file input with its id, name and accept, so a label, a tap, `setInputFiles` and a screen reader all reach it', () => {
    const markup = render();
    const input = /<input[^>]*>/.exec(markup)?.[0] ?? '';
    expect(input).toContain('id="post-file"');
    expect(input).toContain('name="file"');
    expect(input).toContain('type="file"');
    expect(input).toContain('accept="video/mp4"');
    // Described by the field's hint and by the chosen name.
    expect(markup).toContain('aria-describedby="post-file-hint post-file-name"');
    expect(markup).toContain('id="post-file-name"');
  });

  it('keeps the input in the page and focusable: see-through over its box, never hidden, never a clipped one-pixel box', () => {
    const markup = render();
    const input = /<input[^>]*>/.exec(markup)?.[0] ?? '';
    expect(input).toContain('opacity-0');
    expect(input).toContain('absolute inset-0');
    expect(input).toContain('h-full w-full');
    for (const hidden of ['hidden', 'sr-only', 'display:none', 'tabindex="-1"', 'aria-hidden']) {
      expect(input, hidden).not.toContain(hidden);
    }
    expect(markup).not.toContain('sr-only');
    // The input comes first, so the box after it can show its focus ring (`peer-focus-visible`).
    expect(markup.indexOf('<input')).toBeLessThan(markup.indexOf('data-testid="post-file-box"'));
    expect(input).toContain('peer');
    expect(markup).toContain('peer-focus-visible:outline-2');
  });

  it('draws a button-like line and the chosen name in text that wraps, starting at "No file chosen"', () => {
    const markup = render();
    expect(markup).toContain('flex-wrap');
    expect(markup).toContain('wrap-anywhere');
    expect(markup).toContain('>Choose a file</span>');
    expect(markup).toMatch(/data-testid="post-file-name"[^>]*>No file chosen</);
    // Nothing is a fixed width, and nothing clips.
    expect(markup).not.toMatch(/overflow-hidden|truncate|text-ellipsis|whitespace-nowrap/);
    expect(markup).not.toMatch(/ style="[^"]*width/);
  });

  it('is dimmed with its fieldset while a Preview or a Post is sending', () => {
    expect(render()).toContain('peer-disabled:opacity-60');
  });
});
