import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { basicsOf } from '@/lib/social/skill-file.ts';
import { GET } from './route.ts';

/**
 * /skill.md (docs/social/agents-design.md, section 2, "/skill.md"): not found where social is off, else the
 * skill file as markdown with the request's own address filled in, kept at the edge for 5 minutes, and the very
 * text and version `social.basics` and `social_basics` answer.
 */

const at = (url: string) => GET(new Request(url));

beforeEach(() => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VERCEL_TARGET_ENV', 'staging');
});

afterEach(() => vi.unstubAllEnvs());

describe('/skill.md', () => {
  it('is not found on production, kept by no one', async () => {
    vi.stubEnv('VERCEL_TARGET_ENV', 'production');
    const answer = await at('https://hrizzup.com/skill.md');
    expect(answer.status).toBe(404);
    expect(await answer.text()).toBe('Not found\n');
    expect(answer.headers.get('Cache-Control')).toBe('private, no-store');
    expect(answer.headers.get('Vercel-CDN-Cache-Control')).toBeNull();
  });

  it('is markdown, kept at the edge for 5 minutes and refreshed for an hour, tagged social:basics', async () => {
    const answer = await at('https://staging.hrizzup.com/skill.md');
    expect(answer.status).toBe(200);
    expect(answer.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
    expect(answer.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');
    expect(answer.headers.get('Vercel-CDN-Cache-Control')).toBe(
      'max-age=300, stale-while-revalidate=3600',
    );
    expect(answer.headers.get('Vercel-Cache-Tag')).toBe('social:basics');
  });

  it('says the address it was read from, so an agent sends its key to that site', async () => {
    for (const origin of ['https://staging.hrizzup.com', 'https://abc-preview.hrizzup.test']) {
      const text = await (await at(`${origin}/skill.md`)).text();
      expect(text).toContain(`${origin}/api/v1/mcp`);
      expect(text).toContain(`Send it only to \`${origin}\``);
      expect(text).not.toContain('{{');
      expect(text).not.toContain('<!-- part');
    }
  });

  it('is the same text as the basics, and so the same version', async () => {
    const origin = 'https://abc-preview.hrizzup.test';
    const text = await (await at(`${origin}/skill.md?v=1`)).text();
    expect(text).toBe(basicsOf(origin).markdown);
  });
});
