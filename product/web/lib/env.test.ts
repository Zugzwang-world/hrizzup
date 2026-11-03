import { describe, expect, it } from 'vitest';
import { currentEnvironment, currentRegion, signInTestEnabled } from './env.ts';

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
