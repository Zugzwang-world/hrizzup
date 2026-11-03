import { describe, expect, it } from 'vitest';
import { redisKey, redisPrefixFor } from './environments.ts';

describe('redisKey', () => {
  it('starts with the environment and the purpose', () => {
    expect(redisKey('stg', 'cache', 'feed', 'v2', 'home')).toBe('stg:cache:feed:v2:home');
  });

  it('refuses an unknown environment prefix', () => {
    expect(() => redisKey('prod', 'cache', 'home')).toThrow(/prefix/);
  });

  it('refuses parts that could hold personal data or break the key format', () => {
    expect(() => redisKey('stg', 'rate', 'someone@example.com')).toThrow();
    expect(() => redisKey('stg', 'rate', 'a:b')).toThrow();
    expect(() => redisKey('stg', 'Cache', 'x')).toThrow();
  });

  it('needs a name after the purpose', () => {
    expect(() => redisKey('stg', 'cache')).toThrow(/name/);
  });

  it('maps every environment to its prefix', () => {
    expect(redisPrefixFor('production')).toBe('prd');
    expect(redisPrefixFor('preview')).toBe('pre');
  });
});
