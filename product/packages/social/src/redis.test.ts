import { describe, expect, it } from 'vitest';
import { socialRedis } from './redis.ts';

const ID = '01a1e8e0-a980-7b94-99cf-b43959d7d740';
const OTHER = '01a1e41f-02c0-7dab-8826-12d8d8dab1e9';
const HASH = 'ab'.repeat(32);

describe("social's Redis keys", () => {
  it('are the names the caching map gives, each starting with the environment', () => {
    expect(socialRedis.brief.key('stg', ID)).toBe(`stg:cache:social-brief:v1:${ID}`);
    expect(socialRedis.file.key('stg', 'delhi_explainer', 'profile')).toBe(
      'stg:cache:social-file:v1:delhi_explainer:profile',
    );
    expect(socialRedis.checkin.key('pre', ID)).toBe(`pre:cache:social-checkin:v2:${ID}`);
    expect(socialRedis.inbox.key('pre', ID)).toBe(`pre:cache:social-inbox:v1:${ID}`);
    expect(socialRedis.chat.key('dev', ID)).toBe(`dev:cache:social-chat:v1:${ID}`);
    expect(socialRedis.reader.key('dev:slot2', ID)).toBe(`dev:slot2:cache:social-reader:v1:${ID}`);
    expect(socialRedis.forYou.key('stg', ID)).toBe(`stg:cache:social-foryou:v1:${ID}`);
    expect(socialRedis.boardTop.key('stg')).toBe('stg:cache:social-board-top:v1');
    expect(socialRedis.keyCopy.key('stg', HASH)).toBe(`stg:key:v2:${HASH}`);
    expect(socialRedis.counts.key('stg')).toBe('stg:count:social:v1');
    expect(socialRedis.seen.key('stg', '20261117', 'post', ID)).toBe(
      `stg:seen:v1:20261117:post:${ID}`,
    );
    expect(socialRedis.visitorCap.key('stg', '20261117', 'post', ID, HASH.slice(0, 32))).toBe(
      `stg:vcap:v1:20261117:post-${ID}:${HASH.slice(0, 32)}`,
    );
    expect(socialRedis.unique.key('prd', 'file', ID)).toBe(`prd:uniq:v1:file:${ID}`);
    expect(socialRedis.note.key('stg', ID)).toBe(`stg:note:v1:${ID}`);
  });

  it('have the lifetimes the caching map gives, every one a whole number of seconds', () => {
    expect(
      Object.fromEntries(Object.entries(socialRedis).map(([name, { seconds }]) => [name, seconds])),
    ).toEqual({
      brief: 120,
      file: 60,
      checkin: 30,
      inbox: 30,
      chat: 60,
      reader: 60,
      forYou: 300,
      boardTop: 60,
      keyCopy: 60,
      counts: 86_400,
      seen: 129_600, // 36 hours
      visitorCap: 129_600, // 36 hours: it ends with the day's set
      unique: 7_776_000, // 90 days
      note: 3_600,
    });
    for (const { seconds } of Object.values(socialRedis)) {
      expect(Number.isInteger(seconds)).toBe(true);
      expect(seconds).toBeGreaterThan(0);
    }
  });

  it('refuse an environment that is not one', () => {
    expect(() => socialRedis.brief.key('prod', ID)).toThrow(/prefix/);
    expect(() => socialRedis.boardTop.key('')).toThrow(/prefix/);
    expect(() => socialRedis.counts.key('stg:slot2')).toThrow(/prefix/);
  });

  it('hold only IDs, never a name, an email or a secret', () => {
    for (const bad of [
      'someone@example.com',
      'Delhi Explainer',
      ID.toUpperCase(),
      'a:b',
      '',
      `${ID}:x`,
    ]) {
      expect(() => socialRedis.brief.key('stg', bad), bad).toThrow(TypeError);
      expect(() => socialRedis.checkin.key('stg', bad), bad).toThrow(TypeError);
      expect(() => socialRedis.inbox.key('stg', bad), bad).toThrow(TypeError);
      expect(() => socialRedis.chat.key('stg', bad), bad).toThrow(TypeError);
      expect(() => socialRedis.reader.key('stg', bad), bad).toThrow(TypeError);
      expect(() => socialRedis.forYou.key('stg', bad), bad).toThrow(TypeError);
      expect(() => socialRedis.seen.key('stg', '20261117', 'post', bad), bad).toThrow(TypeError);
      expect(() => socialRedis.unique.key('stg', 'post', bad), bad).toThrow(TypeError);
    }
    // A file's key holds a handle and a file name, both public codes.
    expect(() => socialRedis.file.key('stg', 'Someone@example.com', 'profile')).toThrow();
    expect(() => socialRedis.file.key('stg', 'delhi_explainer', 'a:b')).toThrow();
    expect(() => socialRedis.file.key('stg', 'delhi_explainer', '')).toThrow();
  });

  it("name a key's copy by its hash alone, 64 hex characters", () => {
    expect(() => socialRedis.keyCopy.key('stg', `hz_demo_${'a'.repeat(43)}`)).toThrow(TypeError);
    expect(() => socialRedis.keyCopy.key('stg', HASH.slice(1))).toThrow(TypeError);
    expect(() => socialRedis.keyCopy.key('stg', HASH.toUpperCase())).toThrow(TypeError);
  });

  it("take a view's kind and day exactly", () => {
    expect(() => socialRedis.seen.key('stg', '2026-11-17', 'post', ID)).toThrow(TypeError);
    expect(() => socialRedis.seen.key('stg', '20261117', 'agent' as never, ID)).toThrow(TypeError);
    expect(() => socialRedis.unique.key('stg', 'reply' as never, ID)).toThrow(TypeError);
    expect(socialRedis.unique.key('stg', 'story', OTHER)).toBe(`stg:uniq:v1:story:${OTHER}`);
  });

  it('write a note by its request ID in lower case, so one ID is one key', () => {
    expect(socialRedis.note.key('stg', ID.toUpperCase())).toBe(socialRedis.note.key('stg', ID));
    expect(() => socialRedis.note.key('stg', 'not-a-uuid')).toThrow(TypeError);
    expect(() => socialRedis.note.key('stg', 'someone@example.com')).toThrow(TypeError);
  });

  it("name a visitor's cap by the day's token alone: 32 lower-case hex characters, never an address or a visitor", () => {
    const token = HASH.slice(0, 32);
    for (const bad of [
      '198.51.100.7',
      'someone@example.com',
      token.toUpperCase(),
      token.slice(1),
      `${token}0`,
      'a:b',
      '',
    ]) {
      expect(() => socialRedis.visitorCap.key('stg', '20261117', 'post', ID, bad), bad).toThrow(
        TypeError,
      );
    }
    expect(() => socialRedis.visitorCap.key('stg', '2026-11-17', 'post', ID, token)).toThrow(
      TypeError,
    );
    expect(() =>
      socialRedis.visitorCap.key('stg', '20261117', 'agent' as never, ID, token),
    ).toThrow(TypeError);
    expect(() => socialRedis.visitorCap.key('stg', '20261117', 'post', 'not-an-id', token)).toThrow(
      TypeError,
    );
    expect(() => socialRedis.visitorCap.key('prod', '20261117', 'post', ID, token)).toThrow(
      /prefix/,
    );
  });
});
