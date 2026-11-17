import { describe, expect, it } from 'vitest';
import {
  currentEnvironment,
  currentRegion,
  signInTestEnabled,
  socialEnabled,
  testStoriesEnabled,
} from './env.ts';

describe('currentEnvironment', () => {
  it('reads Vercel target environments', () => {
    expect(currentEnvironment({ VERCEL: '1', VERCEL_TARGET_ENV: 'staging' })).toBe('staging');
    expect(currentEnvironment({ VERCEL: '1', VERCEL_TARGET_ENV: 'preview' })).toBe('preview');
    expect(currentEnvironment({ VERCEL: '1', VERCEL_TARGET_ENV: 'production' })).toBe('production');
  });

  it('treats anything unexpected on Vercel as production, so test pages never leak there', () => {
    expect(currentEnvironment({ VERCEL: '1' })).toBe('production');
    expect(currentEnvironment({ VERCEL: '1', VERCEL_TARGET_ENV: 'qa' })).toBe('production');
    expect(signInTestEnabled({ VERCEL: '1' })).toBe(false);
  });

  it('is development off Vercel', () => {
    expect(currentEnvironment({})).toBe('development');
    expect(signInTestEnabled({})).toBe(true);
  });
});

describe('currentRegion', () => {
  it('reports the function region, or local on this Mac', () => {
    expect(currentRegion({ VERCEL: '1', VERCEL_REGION: 'bom1' })).toBe('bom1');
    expect(currentRegion({})).toBe('local');
  });
});

describe('social and its test stories', () => {
  it('are on staging, its previews and this Mac, and off on production, forever', () => {
    for (const env of [
      { VERCEL: '1', VERCEL_TARGET_ENV: 'staging' },
      { VERCEL: '1', VERCEL_TARGET_ENV: 'preview' },
      { VERCEL: '1', VERCEL_ENV: 'preview' },
      {},
    ]) {
      expect(socialEnabled(env), JSON.stringify(env)).toBe(true);
      expect(testStoriesEnabled(env), JSON.stringify(env)).toBe(true);
    }
    expect(socialEnabled({ VERCEL: '1', VERCEL_TARGET_ENV: 'production' })).toBe(false);
    expect(testStoriesEnabled({ VERCEL: '1', VERCEL_TARGET_ENV: 'production' })).toBe(false);
  });

  it('are off on anything unexpected on Vercel, as production is the safest reading', () => {
    for (const env of [{ VERCEL: '1' }, { VERCEL: '1', VERCEL_TARGET_ENV: 'qa' }]) {
      expect(socialEnabled(env), JSON.stringify(env)).toBe(false);
      expect(testStoriesEnabled(env), JSON.stringify(env)).toBe(false);
    }
  });
});
