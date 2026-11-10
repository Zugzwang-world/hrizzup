import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contract } from './contract.ts';
import { isPublished, openapiPath, renderOpenAPI } from './openapi.ts';
import { procedures } from './procedures.ts';

/**
 * The public API's OpenAPI file (PLAN.md step 3.5a): made from the contract, kept in the
 * repository, and describing every public call and nothing else. Quick checks compare it with
 * main's for breaking changes (.github/scripts/api_breaking.py).
 */

type Operation = {
  operationId: string;
  tags?: string[];
  security?: unknown[];
  responses: Record<string, unknown>;
};

const file = () =>
  JSON.parse(readFileSync(openapiPath, 'utf8')) as {
    openapi: string;
    servers: { url: string }[];
    paths: Record<string, Record<string, Operation>>;
    components: { schemas: Record<string, unknown> };
  };

const operations = () =>
  Object.values(file().paths).flatMap((item) => Object.values(item)) as Operation[];

describe('the OpenAPI file', () => {
  it('is current (if not, run `pnpm --filter @hrizzup/api openapi`)', async () => {
    expect(readFileSync(openapiPath, 'utf8')).toBe(await renderOpenAPI());
  });

  it('describes every public call, and never the console, the app’s sign-in or the keys’ own calls', () => {
    const published = procedures(contract)
      .filter(([name]) => isPublished(name.split('.')))
      .map(([name]) => name)
      .sort();
    expect(published.length).toBeGreaterThanOrEqual(12);
    expect(
      operations()
        .map((operation) => operation.operationId)
        .sort(),
    ).toEqual(published);
    for (const path of Object.keys(file().paths)) {
      expect(path).not.toMatch(/^\/(admin|auth)\b|^\/me\/keys/);
    }
  });

  it('is OpenAPI 3.1, served from staging, the demo', () => {
    expect(file().openapi).toMatch(/^3\.1\./);
    expect(file().servers).toEqual([
      expect.objectContaining({ url: 'https://staging.hrizzup.com/api/v1' }),
    ]);
  });

  it('asks for the key on every personal call and on no public read', () => {
    for (const operation of operations()) {
      const personal = operation.tags?.includes('personal') ?? false;
      expect(operation.security, operation.operationId).toEqual(
        personal ? [{ apiKey: [] }] : undefined,
      );
    }
  });

  it("lists each call's errors, and describes a market as the agreement does", () => {
    for (const operation of operations()) {
      expect(Object.keys(operation.responses), operation.operationId).toEqual(
        expect.arrayContaining(['200', '400', '503']),
      );
    }
    const market = file().components.schemas.Market as { required: string[] };
    expect(market.required).toContain('question');
    expect(JSON.stringify(file())).not.toContain('"not":{}');
  });
});
