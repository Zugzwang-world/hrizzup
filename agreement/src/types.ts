import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile, type JSONSchema } from 'json-schema-to-typescript';
import { type Format, parts, shapes } from './definitions.ts';

/**
 * TypeScript types for the agreement's shapes, written from the definitions so they can never
 * say anything the definitions don't (CLAUDE.md, "The hand-over agreement"):
 *
 *   pnpm --filter @hrizzup/agreement types     # rewrites src/types.generated.ts
 *
 * The agreement's check fails when the file differs from what this writes now (types.test.ts),
 * so a changed definition can't leave stale types behind.
 *
 * The types describe each record's fields. The rules that a type can't hold (patterns, lengths,
 * "required only when", hidden characters) stay in `validate()`, which every hand-over point
 * still runs (agreement/README.md); `standardSchema()` runs it for the typed API.
 */

export const typesPath = fileURLToPath(new URL('./types.generated.ts', import.meta.url));

/** The type's name for each format. */
export const typeNames = {
  'story/1': 'Story',
  'update/1': 'Update',
  'sourced/1': 'Sourced',
  'creation/1': 'Creation',
  'market/1': 'Market',
} as const satisfies Record<Format, string>;

type Node = { [key: string]: unknown };

const byFile = new Map<string, Node>(
  [...parts, ...Object.values(shapes)].map((schema) => {
    const id = (schema as { $id: string }).$id;
    return [id.slice(id.lastIndexOf('/') + 1), schema as unknown as Node];
  }),
);

/** Follows a reference (`common.schema.json#/$defs/time`, `#/$defs/pixels`) to its schema. */
function follow(ref: string, file: string): { schema: Node; file: string } {
  const [target = '', pointer = ''] = ref.split('#');
  const inFile = target || file;
  let node: unknown = byFile.get(inFile);
  if (!node) throw new Error(`No definition file ${inFile} for ${ref}`);
  for (const part of pointer.split('/').filter(Boolean)) {
    node = (node as Node)[part.replaceAll('~1', '/').replaceAll('~0', '~')];
  }
  if (typeof node !== 'object' || node === null) throw new Error(`${ref} leads nowhere`);
  return { schema: node as Node, file: inFile };
}

const SCHEMA_MAPS = new Set(['properties', 'patternProperties', '$defs', 'dependentSchemas']);
const SCHEMA_LISTS = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
const SCHEMA_KEYS = new Set([
  'items',
  'additionalProperties',
  'unevaluatedProperties',
  'contains',
  'propertyNames',
  'not',
]);
// Rules about which fields are required when, which a type can't express; validate() keeps them.
const RULES_ONLY = new Set(['if', 'then', 'else', 'dependentRequired']);

/** A part that only says which fields are required (when), such as "based_on or sources". */
function onlyRequiredRules(node: unknown): boolean {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return false;
  return Object.entries(node).every(([key, value]) =>
    key === 'required'
      ? true
      : (key === 'anyOf' || key === 'oneOf' || key === 'allOf') && Array.isArray(value)
        ? value.every(onlyRequiredRules)
        : key === 'not' && onlyRequiredRules(value),
  );
}

/**
 * One schema with every reference replaced by what it points to, the `title` keywords taken
 * out below the top (each would become a separate, oddly named type) and the rules about which
 * fields are required when left to validate().
 */
function prepare(schema: Node, file: string): Node {
  if (typeof schema.$ref === 'string') {
    const { $ref: _ref, ...rest } = schema;
    const target = follow(schema.$ref, file);
    return { ...prepare(target.schema, target.file), ...prepare(rest, file) };
  }
  const out: Node = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'title' || key === '$id' || key === '$schema' || RULES_ONLY.has(key)) continue;
    if (key === '$defs' || (key === 'not' && onlyRequiredRules(value))) continue;
    if (SCHEMA_MAPS.has(key) && value && typeof value === 'object') {
      out[key] = Object.fromEntries(
        Object.entries(value as Node).map(([name, sub]) => [name, prepare(sub as Node, file)]),
      );
    } else if (SCHEMA_LISTS.has(key) && Array.isArray(value)) {
      const list = value
        .filter((sub) => !onlyRequiredRules(sub))
        .map((sub) => prepare(sub as Node, file))
        .filter((sub) => Object.keys(sub).length > 0);
      if (list.length > 0) out[key] = list;
    } else if (SCHEMA_KEYS.has(key) && value && typeof value === 'object') {
      out[key] = prepare(value as Node, file);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** The whole generated file, as `types.generated.ts` must hold it. */
export async function renderTypes(): Promise<string> {
  const blocks: string[] = [];
  for (const [format, name] of Object.entries(typeNames) as [Format, string][]) {
    const schema = shapes[format] as unknown as Node;
    const id = schema.$id as string;
    const prepared = { ...prepare(schema, id.slice(id.lastIndexOf('/') + 1)), title: name };
    blocks.push(
      await compile(prepared as JSONSchema, name, {
        bannerComment: '',
        additionalProperties: false,
        ignoreMinAndMaxItems: true,
        strictIndexSignatures: true,
        style: { singleQuote: true, printWidth: 100 },
      }),
    );
  }
  const header = [
    '// Written by `pnpm --filter @hrizzup/agreement types` from agreement/definitions. Never edit',
    "// it by hand: change a definition and run that command; the agreement's check fails when",
    '// this file is stale (src/types.test.ts).',
    '',
  ].join('\n');
  const map = [
    '/** The type of each format the agreement defines. */',
    'export type Shapes = {',
    ...Object.entries(typeNames).map(([format, name]) => `  '${format}': ${name};`),
    '};',
    '',
  ].join('\n');
  return `${header}\n${blocks.join('\n')}\n${map}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--write')) {
  const next = await renderTypes();
  const current = (() => {
    try {
      return readFileSync(typesPath, 'utf8');
    } catch {
      return '';
    }
  })();
  if (current === next) {
    console.log('src/types.generated.ts is already up to date.');
  } else {
    writeFileSync(typesPath, next);
    console.log('Rewrote src/types.generated.ts from the definitions.');
  }
}
