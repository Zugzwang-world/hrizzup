import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { OpenAPIGenerator, type OpenAPIGeneratorGenerateOptions } from '@orpc/openapi';
import { JSON_SCHEMA_OUTPUT_REGISTRY, ZodToJsonSchemaConverter } from '@orpc/zod/zod4';
import { contract } from './contract.ts';
import { marketRecord } from './trading.ts';

/**
 * The public API's OpenAPI file (PLAN.md step 3.5a; docs/research/public-api.md, sections 2.6 and
 * 2.11), made from the contract by oRPC's own generator and kept in the repository, so every
 * change to a public call shows in its pull request:
 *
 *   pnpm --filter @hrizzup/api openapi    # rewrites openapi.json
 *
 * The tests fail when the file is stale (openapi.test.ts), and Quick checks fail a pull request
 * whose file breaks a v1 call that main's file has (.github/scripts/api_breaking.py, with oasdiff):
 * within v1, only additions.
 *
 * It holds the public calls only: never the console's (admins only), the app's own sign-in, or the
 * keys' own calls (made only by someone signed in on the website, never by a bot).
 */
export const openapiPath = fileURLToPath(new URL('../openapi.json', import.meta.url));

/** The parts of the contract a bot never calls, so the published file leaves them out. */
const UNPUBLISHED = new Set(['admin', 'auth', 'keys']);

/** Whether a call, by its path in the contract (`markets.list`), is in the published file. */
export function isPublished(path: readonly string[]): boolean {
  return !UNPUBLISHED.has(path[0] ?? '');
}

const DESCRIPTION = `Hrizzup's API for bots and AI tools: play-money prediction markets and a Bitcoin perp, with the same calls Hrizzup's website and app use.

**This is the demo, on staging:** play money only, keys that work only here, and data that may be reset (with notice in the changelog). Production's API opens at launch.

- **Public reads need no key** (markets, perps, health) and are kept at the edge for a few seconds. Send them no key: a request with an \`Authorization\` header is never answered from the edge's copy.
- **Personal calls need a key** (your balance, positions, orders; and, with a trading key, trading and the perp): \`Authorization: Bearer <key>\`. Manifold's \`Authorization: Key <key>\` works too. Make keys on the sandbox's keys page, signed in.
- **Amounts are exact decimal text** (\`"25"\`, \`"2.5"\`), never JSON numbers, and times are ISO 8601 in UTC.
- **Lists page one way:** \`limit\` (1 to 100, 50 by default) and \`cursor\`, the \`next\` of the page before, sent back as it came; \`next\` is null on the last page.
- **Every refusal has one format:** \`{ defined, code, status, message, data }\`; a refused input is 400 \`BAD_REQUEST\` with each problem in \`data.issues\`.
- **Limits:** 60 requests a minute from each address, 120 personal reads a minute for each key, 30 trades a minute for each account. Past one, 429 with \`Retry-After\`; the \`RateLimit-Policy\` and \`RateLimit\` headers say how much is left.
- **Versioning:** within v1, only additions: new calls, new optional inputs, new fields. Ignore fields you don't know.`;

type Json = { [key: string]: unknown };

/** One of the agreement's definitions (agreement/definitions), as its own JSON Schema file. */
function definition(file: string): Json {
  const path = fileURLToPath(new URL(`../../../../agreement/definitions/${file}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as Json;
}

/** A shared definition's name among the file's schemas: `agreement.common.time`. */
const sharedName = (file: string, name: string) =>
  `agreement.${file.replace(/\.schema\.json$/, '').replace(/\.v\d+$/, '')}.${name}`;

/** Points a definition's `$ref`s (`common.schema.json#/$defs/time`, `#/$defs/x`) at the file's own schemas. */
function relink(value: unknown, file: string, seen: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => relink(item, file, seen));
  if (value === null || typeof value !== 'object') return value;
  const out: Json = {};
  for (const [key, inner] of Object.entries(value as Json)) {
    if (key === '$schema' || key === '$id' || key === '$defs') continue;
    if (key === '$ref' && typeof inner === 'string') {
      const [target, pointer] = inner.split('#');
      const name = /^\/\$defs\/(.+)$/.exec(pointer ?? '')?.[1];
      if (!name) throw new Error(`Unexpected $ref in ${file}: ${inner}`);
      const from = target || file;
      seen.add(`${from}#${name}`);
      out.$ref = `#/components/schemas/${sharedName(from, name)}`;
      continue;
    }
    out[key] = relink(inner, file, seen);
  }
  return out;
}

/**
 * The agreement's market record (market/1) as the file's own schemas: the agreement's JSON Schema
 * itself, the only definition of the shape, with every definition it uses, so the file describes
 * exactly what the agreement's check holds markets to.
 */
function marketSchemas(): Record<string, unknown> {
  const seen = new Set<string>();
  const schemas: Record<string, unknown> = {
    Market: relink(definition('market.v1.schema.json'), 'market.v1.schema.json', seen),
  };
  const done = new Set<string>();
  for (
    let pending = [...seen];
    pending.length > 0;
    pending = [...seen].filter((x) => !done.has(x))
  ) {
    for (const item of pending) {
      done.add(item);
      const [file, name] = item.split('#') as [string, string];
      const defs = definition(file).$defs as Json | undefined;
      if (!defs?.[name]) throw new Error(`No definition ${name} in ${file}`);
      schemas[sharedName(file, name)] = relink(defs[name], file, seen);
    }
  }
  return Object.fromEntries(Object.entries(schemas).sort(([a], [b]) => a.localeCompare(b)));
}

type Schemas = NonNullable<NonNullable<OpenAPIGeneratorGenerateOptions['components']>['schemas']>;

/**
 * Drops the "matches nothing" the generator writes for a shape Zod can't describe (`not: {}`)
 * where the file points at a schema of its own instead (the market record).
 */
function tidy(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(tidy);
  if (value === null || typeof value !== 'object') return value;
  const out: Json = {};
  for (const [key, inner] of Object.entries(value as Json)) out[key] = tidy(inner);
  if ('$ref' in out && JSON.stringify(out.not) === '{}') delete out.not;
  return out;
}

/** The OpenAPI file, as written to openapi.json. */
export async function renderOpenAPI(): Promise<string> {
  // The market record is checked by the agreement's own check, not a Zod shape: the file uses the
  // agreement's JSON Schema for it.
  if (!JSON_SCHEMA_OUTPUT_REGISTRY.has(marketRecord)) {
    JSON_SCHEMA_OUTPUT_REGISTRY.add(marketRecord, { $ref: '#/components/schemas/Market' });
  }
  const generator = new OpenAPIGenerator({ schemaConverters: [new ZodToJsonSchemaConverter()] });
  const document = await generator.generate(contract, {
    info: { title: 'Hrizzup API', version: '1.0.0', description: DESCRIPTION },
    servers: [
      {
        url: 'https://staging.hrizzup.com/api/v1',
        description:
          'Staging, the demo: play money, keys that work only here, data that may be reset',
      },
    ],
    tags: [
      { name: 'public', description: 'Reads anyone may make, with no key, kept at the edge' },
      { name: 'personal', description: 'Your own play money, and trading: with your API key' },
    ],
    components: {
      schemas: marketSchemas() as Schemas,
      securitySchemes: {
        apiKey: {
          type: 'http',
          scheme: 'bearer',
          description:
            "Your API key (`hz_demo_…`), from the sandbox's keys page: read-only or trading. Shown once when made.",
        },
      },
    },
    filter: ({ path }) => isPublished(path),
  });
  // Every personal call takes the key; public reads take none.
  for (const item of Object.values(document.paths ?? {})) {
    for (const operation of Object.values(item ?? {})) {
      const tags = (operation as { tags?: string[] } | undefined)?.tags;
      if (tags?.includes('personal')) {
        (operation as { security?: unknown }).security = [{ apiKey: [] }];
      }
    }
  }
  return `${JSON.stringify(tidy(document), null, 2)}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--write')) {
  const next = await renderOpenAPI();
  let current = '';
  try {
    current = readFileSync(openapiPath, 'utf8');
  } catch {}
  if (current === next) console.log('openapi.json is already up to date.');
  else {
    writeFileSync(openapiPath, next);
    console.log('Rewrote openapi.json from the contract.');
  }
}
