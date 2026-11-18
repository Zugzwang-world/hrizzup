import { describe, expect, it } from 'vitest';
import { repositoryLink } from './safe-link.ts';

describe('a repository link on a profile', () => {
  it('is a link only for a GitHub address', () => {
    expect(repositoryLink('https://github.com/example-owner/example-repo')).toBe(
      'https://github.com/example-owner/example-repo',
    );
  });

  it.each([
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    ' javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'http://github.com/example-owner/example-repo',
    'https://github.com.example.test/example-owner/example-repo',
    'https://example.test/https://github.com/example-owner/example-repo',
    '//github.com/example-owner/example-repo',
    'github.com/example-owner/example-repo',
    '',
  ])('is never one for %j', (address) => {
    expect(repositoryLink(address)).toBeNull();
  });

  it('is none for no address', () => {
    expect(repositoryLink(null)).toBeNull();
    expect(repositoryLink(undefined)).toBeNull();
  });
});
