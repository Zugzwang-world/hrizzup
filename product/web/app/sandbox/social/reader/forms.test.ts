import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * The reader's two forms as they are first drawn (docs/social/r12-design.md, section 4.4): Vitest has no browser, so
 * what a press does is the journey's (`e2e/journeys/social-reader.spec.ts`) and the actions' own test; this holds
 * what each form draws, for a reader who can send and for one who can't, and the rules the Screen check also holds a
 * page to (a field grid of one column, no hidden text, no fixed pixel widths).
 */

vi.mock('./actions.ts', () => ({ sendMessage: vi.fn(), saveProfile: vi.fn() }));

const { ChatForm } = await import('./chat-form.tsx');
const { ProfileForm } = await import('./profile-form.tsx');

const chat = (blocked: string | null) => renderToStaticMarkup(createElement(ChatForm, { blocked }));
const profile = (text: string) =>
  renderToStaticMarkup(createElement(ProfileForm, { profile: text }));

describe('the chat form', () => {
  it('has a labelled field of at most 2,000 characters, and a Send button that works when the reader may send', () => {
    const markup = chat(null);
    expect(markup).toContain('data-testid="reader-chat-form"');
    expect(markup).toMatch(/<label[^>]*for="reader-message"[^>]*>Your message<\/label>/);
    expect(markup).toMatch(/<textarea[^>]*id="reader-message"/);
    expect(markup).toContain('maxLength="2000"');
    expect(markup).toContain('required');
    expect(markup).toMatch(/<button type="submit"[^>]*>Send<\/button>/);
    expect(markup).not.toContain('disabled=""');
  });

  it('disables Send when chat is paused or the day’s messages are used, which the page says above it', () => {
    const markup = chat('Chat pauses until 05:30 IST: your feed keeps working');
    expect(markup).toMatch(/<button type="submit"[^>]*\sdisabled=""[^>]*>Send<\/button>/);
  });

  it('shows no answer until one comes, and no waiting line', () => {
    const markup = chat(null);
    expect(markup).not.toContain('data-testid="reader-chat-answer"');
    expect(markup).not.toContain('data-testid="reader-chat-waiting"');
  });
});

describe('the profile form', () => {
  const stored = '# Reading profile\n\n## More of\n- AI & <b>news</b>\n\n## Less of\n\n## Formats';

  it('holds the profile as stored, escaped, in a field of at most 2,000 characters, with a Save button', () => {
    const markup = profile(stored);
    expect(markup).toContain('data-testid="reader-profile-form"');
    expect(markup).toMatch(/<label[^>]*for="reader-profile"[^>]*>Reading profile<\/label>/);
    // Plain text: the profile's own markup is escaped, never drawn.
    expect(markup).toContain('- AI &amp; &lt;b&gt;news&lt;/b&gt;');
    expect(markup).not.toContain('<b>news</b>');
    expect(markup).toContain('maxLength="2000"');
    expect(markup).toMatch(/<button type="submit"[^>]*>Save<\/button>/);
    expect(markup).not.toContain('disabled=""');
  });

  it('shows no answer until one comes', () => {
    expect(profile(stored)).not.toContain('data-testid="reader-profile-answer"');
  });
});

describe('both forms, as the Screen check holds a page', () => {
  it('lay their fields out in one column, never hide text, and use no fixed pixel widths', () => {
    for (const markup of [chat(null), profile('# Reading profile')]) {
      expect(markup).toContain('grid-cols-1');
      expect(markup).not.toContain('sr-only');
      expect(markup).not.toMatch(/(?:^|[\s"[])(?:w|min-w|max-w)-\[\d+px\]/);
      expect(markup).not.toMatch(/style="[^"]*width:\s*\d+px/);
    }
  });
});
