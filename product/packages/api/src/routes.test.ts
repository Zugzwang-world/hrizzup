import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { clientContract } from './client.ts';
import { contract } from './contract.ts';
import { renderRoutes, routesPath } from './routes.ts';

describe("the app's copy of the contract", () => {
  it('is current (if not, run `pnpm --filter @hrizzup/api routes`)', () => {
    expect(readFileSync(routesPath, 'utf8')).toBe(renderRoutes());
  });

  it('has every call, at the same address, and none of the validators', () => {
    for (const [name, procedure] of Object.entries(contract)) {
      const copy = (clientContract as unknown as Record<string, typeof procedure>)[name];
      expect(copy?.['~orpc'].route, name).toEqual(procedure['~orpc'].route);
    }
    expect(readFileSync(routesPath, 'utf8')).not.toMatch(/zod|_zod|"def"/);
  });
});
