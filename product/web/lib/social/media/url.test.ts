import { describe, expect, it } from 'vitest';
import { mediaBase, mediaPublicUrl } from './url.ts';

/** Where media is served from: `MEDIA_BASE_URL`, only when it is a plain `https://host[:port]`. */

describe('the media host', () => {
  it('is MEDIA_BASE_URL without a final slash, when it is https://host with an optional port', () => {
    expect(mediaBase({ MEDIA_BASE_URL: 'https://media.example.test' })).toBe(
      'https://media.example.test',
    );
    expect(mediaBase({ MEDIA_BASE_URL: 'https://media.example.test/' })).toBe(
      'https://media.example.test',
    );
    expect(mediaBase({ MEDIA_BASE_URL: '  https://media.example.test:8443/ ' })).toBe(
      'https://media.example.test:8443',
    );
  });

  it('is null when it is missing, empty, not https, not lower-case, or has a path, a query or credentials', () => {
    for (const value of [
      undefined,
      '',
      ' ',
      'http://media.example.test',
      'media.example.test',
      'https://Media.example.test',
      'https://media.example.test/files',
      'https://media.example.test?x=1',
      'https://user:pw@media.example.test',
      'https://media.example.test:99999999',
      'https://',
    ]) {
      expect(mediaBase({ MEDIA_BASE_URL: value }), String(value)).toBeNull();
    }
    expect(mediaBase({})).toBeNull();
  });

  it('puts a key after one slash, or nothing when there is no valid host', () => {
    expect(
      mediaPublicUrl('social/a/b.jpg', { MEDIA_BASE_URL: 'https://media.example.test/' }),
    ).toBe('https://media.example.test/social/a/b.jpg');
    expect(mediaPublicUrl('social/a/b.jpg', {})).toBeNull();
  });
});
