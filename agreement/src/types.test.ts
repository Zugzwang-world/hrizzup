import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Format, isFormat } from './definitions.ts';
import { standardSchema } from './standard-schema.ts';
import { renderTypes, typesPath } from './types.ts';

/**
 * Part of the agreement's check: the types are the ones the definitions give now, and the
 * typed API's validators (`standardSchema`) pass every example and refuse what validate()
 * refuses.
 */

const examplesDir = fileURLToPath(new URL('../examples/', import.meta.url));
const examples = readdirSync(examplesDir)
  .filter((f) => f.endsWith('.json'))
  .flatMap((file) => JSON.parse(readFileSync(`${examplesDir}${file}`, 'utf8')) as unknown[]);

describe("the agreement's types", () => {
  it('are current (if not, run `pnpm --filter @hrizzup/agreement types`)', async () => {
    expect(readFileSync(typesPath, 'utf8')).toBe(await renderTypes());
  });
});

describe('the validators for the typed API', () => {
  it('pass every example, as its own format', async () => {
    for (const record of examples) {
      const format = (record as { format: unknown }).format;
      if (!isFormat(format)) throw new Error(`An example has an unknown format: ${String(format)}`);
      const result = await standardSchema(format as Format)['~standard'].validate(record);
      expect(result.issues, JSON.stringify(record).slice(0, 80)).toBeUndefined();
    }
  });

  it('refuse a record of another format', async () => {
    const story = examples.find((r) => (r as { format: string }).format === 'story/1');
    const result = await standardSchema('update/1')['~standard'].validate(story);
    expect(result.issues).toEqual([{ message: 'must be update/1', path: ['format'] }]);
  });

  it("refuse what the agreement's check refuses, pointing at the field", async () => {
    const story = structuredClone(
      examples.find((r) => (r as { format: string }).format === 'story/1'),
    ) as { categories: string[] };
    story.categories = ['not-a-category'];
    const result = await standardSchema('story/1')['~standard'].validate(story);
    expect(result.issues?.length).toBeGreaterThan(0);
    expect(result.issues?.every((issue) => issue.path?.[0] === 'categories')).toBe(true);
  });

  it('refuse hidden characters that only validate() catches, beyond the patterns', async () => {
    const story = structuredClone(
      examples.find((r) => (r as { format: string }).format === 'story/1'),
    ) as { title: string };
    // A zero-width joiner is allowed inside an emoji, so the pattern lets it through; at the
    // end of the text it hides nothing but itself, which only validate()'s own code refuses.
    story.title = `${story.title}${String.fromCodePoint(0x200d)}`;
    const result = await standardSchema('story/1')['~standard'].validate(story);
    expect(result.issues).toEqual([{ message: 'must not hide characters', path: ['title'] }]);
  });
});
