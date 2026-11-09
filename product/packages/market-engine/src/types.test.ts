import { describe, expect, it } from 'vitest';
import { declarations, written } from '../scripts/types.ts';

describe('the type declarations other packages read (types/)', () => {
  it('are what the source gives now: run `pnpm --filter @hrizzup/market-engine types` if not', {
    timeout: 30_000,
  }, () => {
    const now = declarations();
    expect([...now.keys()].sort()).toEqual([...written().keys()].sort());
    for (const [path, text] of now) expect(written().get(path), path).toBe(text);
  });

  it('describe only what src/index.ts offers, never a test', () => {
    const paths = [...declarations().keys()];
    expect(paths).toContain('index.d.ts');
    expect(paths.filter((path) => path.includes('.test.'))).toEqual([]);
  });
});
