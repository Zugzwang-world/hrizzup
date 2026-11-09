import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { clientContract } from './client.ts';
import { contract } from './contract.ts';
import { procedures } from './procedures.ts';
import { renderRoutes, routesPath } from './routes.ts';

describe("the app's copy of the contract", () => {
  it('is current (if not, run `pnpm --filter @hrizzup/api routes`)', () => {
    expect(readFileSync(routesPath, 'utf8')).toBe(renderRoutes());
  });

  it('has every call, nested ones too, at the same address, and none of the validators', () => {
    const copies = new Map(procedures(clientContract));
    const calls = procedures(contract);
    expect(calls.length).toBeGreaterThan(2);
    for (const [name, procedure] of calls) {
      expect(copies.get(name)?.['~orpc'].route, name).toEqual(procedure['~orpc'].route);
    }
    expect([...copies.keys()].sort()).toEqual(calls.map(([name]) => name).sort());
    expect(readFileSync(routesPath, 'utf8')).not.toMatch(/zod|_zod|"def"/);
  });
});
