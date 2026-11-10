import openapi from '@hrizzup/api/openapi.json' with { type: 'json' };

/**
 * The public API's reference (PLAN.md step 3.5a), read from its OpenAPI file
 * (product/packages/api/openapi.json, made from the contract), so the docs page and llms-full.txt
 * can never say anything the file doesn't: each call's address, whether it needs a key, what it
 * takes, what it answers and its errors, in words.
 */

type Schema = {
  $ref?: string;
  type?: string;
  const?: unknown;
  enum?: unknown[];
  format?: string;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  description?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  anyOf?: Schema[];
  oneOf?: Schema[];
};

type Operation = {
  operationId: string;
  summary?: string;
  tags?: string[];
  security?: unknown[];
  parameters?: { name: string; in: string; required?: boolean; schema: Schema }[];
  requestBody?: { content: Record<string, { schema: Schema }> };
  responses: Record<string, { content?: Record<string, { schema: Schema }> }>;
};

type Document = {
  info: { title: string; version: string; description: string };
  servers: { url: string; description?: string }[];
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, Schema> };
};

const doc = openapi as unknown as Document;

/** One field a call takes or answers: its name (`position.yes`, `markets[].market`), its kind in words. */
export type Field = { name: string; kind: string; required: boolean; note?: string };

/** One form a call's input can take: a buy or a sale, say. */
export type Variant = { when?: string; fields: Field[] };

export type ErrorAnswer = { status: number; code: string; message: string };

export type Call = {
  id: string;
  method: string;
  path: string;
  summary: string;
  /** Needs a key (a personal call); public reads need none. */
  needsKey: boolean;
  /** Where its inputs go: the address's query (a read) or a JSON body (a write). */
  takes: { query: Field[]; path: Field[]; body: Variant[] };
  answers: Field[];
  errors: ErrorAnswer[];
};

const DECIMAL = /^\^-\?\(\?:0\|\[1-9\]\[0-9\]\*\)/;
const AMOUNT = /^\^\(\?:0\|\[1-9\]\[0-9\]\{0,13\}\)/;
const PROBABILITY = /^\^0\\\.\[0-9\]\{1,8\}\$$/;
const RECORD_ID = /7\[0-9a-f\]\{3\}/;

function resolve(schema: Schema): Schema {
  if (!schema.$ref) return schema;
  const name = schema.$ref.replace('#/components/schemas/', '');
  return doc.components.schemas[name] ?? {};
}

/** A schema's kind, in words. */
export function kindOf(schema: Schema): string {
  if (schema.$ref === '#/components/schemas/Market')
    return 'a market, as the hand-over agreement writes it (market/1)';
  const s = resolve(schema);
  const options = s.anyOf ?? s.oneOf;
  if (options) {
    const nullable = options.some((option) => option.type === 'null');
    const rest = options.filter((option) => option.type !== 'null');
    const words = [...new Set(rest.map(kindOf))].join(' or ');
    return nullable ? `${words}, or null` : words;
  }
  if (s.const !== undefined) return JSON.stringify(s.const);
  if (s.enum) return s.enum.map((value) => JSON.stringify(value)).join(' or ');
  switch (s.type) {
    case 'string':
      if (s.format === 'date-time') return 'a time (ISO 8601, UTC)';
      if (s.format === 'uuid') return 'a UUID';
      if (s.pattern && RECORD_ID.test(s.pattern)) return 'an ID';
      if (s.pattern && AMOUNT.test(s.pattern))
        return 'an amount, as text, more than 0, to 6 decimal places';
      if (s.pattern && PROBABILITY.test(s.pattern)) return 'a probability, as text (0.01 to 0.99)';
      if (s.pattern && DECIMAL.test(s.pattern)) return 'an exact decimal, as text';
      if (s.format === 'email') return 'an email address';
      return s.maxLength ? `text (at most ${s.maxLength} characters)` : 'text';
    case 'integer':
    case 'number': {
      const range =
        s.minimum !== undefined && s.maximum !== undefined ? ` (${s.minimum} to ${s.maximum})` : '';
      return `${s.type === 'integer' ? 'a whole number' : 'a number'}${range}`;
    }
    case 'boolean':
      return 'true or false';
    case 'array':
      return s.items ? `a list of ${plural(kindOf(s.items))}` : 'a list';
    case 'object':
      return 'an object';
    default:
      return 'anything';
  }
}

function plural(kind: string): string {
  return kind.replace(/^an? /, '').replace(/^object$/, 'objects');
}

/** An object's fields, one level of nesting named with dots, lists of objects with `[]`. */
function fieldsOf(schema: Schema, prefix = '', depth = 0): Field[] {
  const s = resolve(schema);
  if (s.$ref === undefined && schema.$ref === '#/components/schemas/Market') return [];
  const fields: Field[] = [];
  for (const [name, inner] of Object.entries(s.properties ?? {})) {
    const full = `${prefix}${name}`;
    const required = s.required?.includes(name) ?? false;
    const field = resolve(inner);
    const items = field.type === 'array' && field.items ? resolve(field.items) : undefined;
    const nested = inner.$ref === '#/components/schemas/Market' ? undefined : field;
    fields.push({
      name: full,
      kind: kindOf(inner),
      required,
      ...(inner.description ? { note: inner.description } : {}),
    });
    if (depth < 2 && nested?.type === 'object' && nested.properties) {
      fields.push(...fieldsOf(nested, `${full}.`, depth + 1));
    } else if (
      depth < 2 &&
      items?.type === 'object' &&
      items.properties &&
      field.items?.$ref !== '#/components/schemas/Market'
    ) {
      fields.push(...fieldsOf(items, `${full}[].`, depth + 1));
    }
  }
  return fields;
}

function bodyOf(operation: Operation): Variant[] {
  const schema = operation.requestBody?.content['application/json']?.schema;
  if (!schema) return [];
  const s = resolve(schema);
  const options = s.anyOf ?? s.oneOf;
  if (options) {
    return options.map((option) => {
      const tag = Object.entries(option.properties ?? {}).find(([, v]) => v.const !== undefined);
      return {
        ...(tag ? { when: `${tag[0]} is ${JSON.stringify(tag[1].const)}` } : {}),
        fields: fieldsOf(option),
      };
    });
  }
  return [{ fields: fieldsOf(s) }];
}

function errorsOf(operation: Operation): ErrorAnswer[] {
  const found: ErrorAnswer[] = [];
  for (const [status, response] of Object.entries(operation.responses)) {
    if (status.startsWith('2')) continue;
    const schema = response.content?.['application/json']?.schema;
    for (const option of schema?.oneOf ?? schema?.anyOf ?? [schema ?? {}]) {
      const props = option.properties ?? {};
      if (props.defined?.const !== true || typeof props.code?.const !== 'string') continue;
      found.push({
        status: Number(status),
        code: props.code.const,
        message: String((props.message as { default?: unknown } | undefined)?.default ?? ''),
      });
    }
  }
  return found.sort((a, b) => a.status - b.status);
}

/** Every public call, in the file's order. */
export const calls: Call[] = Object.entries(doc.paths).flatMap(([path, item]) =>
  Object.entries(item).map(([method, operation]) => {
    const parameters = operation.parameters ?? [];
    const field = (p: (typeof parameters)[number]): Field => ({
      name: p.name,
      kind: kindOf(p.schema),
      required: p.required ?? false,
      ...(p.schema.description ? { note: p.schema.description } : {}),
    });
    const ok = Object.entries(operation.responses).find(([status]) => status.startsWith('2'));
    const answer = ok?.[1].content?.['application/json']?.schema;
    return {
      id: operation.operationId,
      method: method.toUpperCase(),
      path,
      summary: operation.summary ?? operation.operationId,
      needsKey: (operation.security?.length ?? 0) > 0,
      takes: {
        query: parameters.filter((p) => p.in === 'query').map(field),
        path: parameters.filter((p) => p.in === 'path').map(field),
        body: bodyOf(operation),
      },
      answers: answer ? fieldsOf(answer) : [],
      errors: errorsOf(operation),
    };
  }),
);

/** Where the API is, and what the file says of itself. */
export const server = doc.servers[0]?.url ?? 'https://staging.hrizzup.com/api/v1';
export const title = doc.info.title;
export const version = doc.info.version;
export const overview = doc.info.description;
