import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parts, shapes } from './definitions.ts';

/**
 * Writes the parts of agreement/README.md that come from the definitions and the examples:
 * each shape's field table, each shared list, and the worked examples. They sit between
 * `<!-- generated: … -->` and `<!-- end generated -->`; the rest of the README is written by
 * hand. The check fails when the README differs from what this writes, so the plain-language
 * agreement can't drift from the definitions. After changing a definition, a list or an
 * example: `pnpm --filter @hrizzup/agreement readme`.
 */

type Node = { [key: string]: unknown };
type Located = { node: Node; file: string };
type Row = { field: string; required: string; meaning: string; holds: string };

const root = fileURLToPath(new URL('..', import.meta.url));

const files = new Map<string, Node>();
for (const schema of [...parts, ...Object.values(shapes)]) files.set(fileOf(schema), schema);

function fileOf(schema: Node): string {
  return String(schema.$id).split('/').pop() ?? '';
}

function resolve(ref: string, from: string): Located {
  const [target = '', pointer = ''] = ref.split('#');
  const file = target || from;
  let node: unknown = files.get(file);
  for (const token of pointer.split('/').slice(1)) {
    node = (node as Node | undefined)?.[token.replaceAll('~1', '/').replaceAll('~0', '~')];
  }
  if (typeof node !== 'object' || node === null) throw new Error(`Can't find ${ref} from ${file}`);
  return { node: node as Node, file };
}

/** A node, then everything its `$ref`s lead to, nearest first. */
function chain(node: Node, file: string): Located[] {
  const links: Located[] = [{ node, file }];
  let at = links[0] as Located;
  while (typeof at.node.$ref === 'string') {
    at = resolve(at.node.$ref, at.file);
    links.push(at);
  }
  return links;
}

function first<T>(links: Located[], key: string): T | undefined {
  return links.map((l) => l.node[key]).find((v) => v !== undefined) as T | undefined;
}

/** Every limit along a chain applies, so the tightest one is the one that counts. */
function tightest(links: Located[], key: string, pick: (...n: number[]) => number) {
  const values = links.map((l) => l.node[key]).filter((v): v is number => typeof v === 'number');
  return values.length > 0 ? pick(...values) : undefined;
}

const number = (n: number) => n.toLocaleString('en-GB');
const code = (v: unknown) => `\`${typeof v === 'string' ? v : JSON.stringify(v)}\``;
const cell = (s: string) => s.replaceAll('|', '\\|');

function either(items: string[]): string {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`;
}

function each(what: string): string {
  if (what === 'The fields below') return 'each with the fields below';
  const lower = what.charAt(0).toLowerCase() + what.slice(1);
  return `each ${/^[aeiou]/.test(lower) ? 'an' : 'a'} ${lower}`;
}

/** What a field can hold, in words, from its definition. */
function holds(node: Node, file: string): string {
  const links = chain(node, file);
  const constant = first<unknown>(links, 'const');
  if (constant !== undefined) return `Always ${code(constant)}`;
  const values = first<unknown[]>(links, 'enum');
  if (values) return either(values.map(code));
  const type = first<string>(links, 'type');
  if (type === 'object') return 'The fields below';
  if (type === 'array') {
    const min = tightest(links, 'minItems', Math.max) ?? 0;
    const max = tightest(links, 'maxItems', Math.min);
    const holder = links.find((l) => l.node.items);
    const item = holder ? holds(holder.node.items as Node, holder.file) : 'Anything';
    const count =
      max === undefined ? `${min} or more` : min === max ? `${min}` : `${min} to ${max}`;
    const unique = links.some((l) => l.node.uniqueItems === true) ? ', no repeats' : '';
    return `${count}, ${each(item)}${unique}`;
  }
  const notes: string[] = [];
  if (type === 'string') {
    const min = tightest(links, 'minLength', Math.max);
    const max = tightest(links, 'maxLength', Math.min);
    if (max !== undefined) {
      notes.push(
        min && min > 1 ? `${min} to ${number(max)} characters` : `up to ${number(max)} characters`,
      );
    }
  }
  if (type === 'integer' || type === 'number') {
    const min = tightest(links, 'minimum', Math.max);
    const above = tightest(links, 'exclusiveMinimum', Math.max);
    const max = tightest(links, 'maximum', Math.min);
    const low =
      above !== undefined
        ? `more than ${number(above)}`
        : min !== undefined
          ? `from ${number(min)}`
          : '';
    const high =
      max === undefined
        ? ''
        : above !== undefined
          ? `and up to ${number(max)}`
          : `to ${number(max)}`;
    if (low || high) notes.push([low, high].filter(Boolean).join(' '));
  }
  const title = first<string>(links, 'title');
  const what =
    title ?? (type === 'integer' ? 'Whole number' : type === 'number' ? 'Number' : 'Text');
  return [what, ...notes].join(', ');
}

/** Fields required only in some cases: named by a `required` inside allOf, anyOf or oneOf. */
function sometimesRequired(object: Node): Set<string> {
  const names = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value !== 'object' || value === null) return;
    const node = value as Node;
    if (Array.isArray(node.required)) for (const name of node.required) names.add(String(name));
    for (const key of ['allOf', 'anyOf', 'oneOf']) {
      if (Array.isArray(node[key])) for (const sub of node[key] as unknown[]) visit(sub);
    }
    visit(node.then);
    visit(node.else);
  };
  for (const key of ['allOf', 'anyOf', 'oneOf']) {
    if (Array.isArray(object[key])) for (const sub of object[key] as unknown[]) visit(sub);
  }
  return names;
}

function rows(object: Node, file: string, prefix = ''): Row[] {
  const properties = (object.properties ?? {}) as Record<string, Node>;
  const required = new Set((object.required as string[] | undefined) ?? []);
  const sometimes = sometimesRequired(object);
  const out: Row[] = [];
  for (const [name, property] of Object.entries(properties)) {
    if (typeof property.description !== 'string') {
      throw new Error(`${file}: the field ${prefix}${name} has no description`);
    }
    out.push({
      field: `${prefix}${name}`,
      required: required.has(name) ? 'Yes' : sometimes.has(name) ? 'Depends' : 'No',
      meaning: property.description,
      holds: holds(property, file),
    });
    // Fields inside an object, or inside each item of a list of objects, get rows of their own.
    const links = chain(property, file);
    const inner = links.find((l) => l.node.properties);
    if (inner) out.push(...rows(inner.node, inner.file, `${prefix}${name}.`));
    const holder = links.find((l) => l.node.items);
    if (holder) {
      const item = chain(holder.node.items as Node, holder.file).find((l) => l.node.properties);
      if (item) out.push(...rows(item.node, item.file, `${prefix}${name}[].`));
    }
  }
  return out;
}

function fieldTable(format: string): string {
  const schema = (shapes as Record<string, Node>)[format];
  if (!schema) throw new Error(`No definition for the format ${format}`);
  const lines = ['| Field | Required | What it means | What it holds |', '|---|---|---|---|'];
  for (const r of rows(schema, fileOf(schema))) {
    lines.push(`| \`${r.field}\` | ${r.required} | ${cell(r.meaning)} | ${cell(r.holds)} |`);
  }
  return lines.join('\n');
}

/** How each grouped list names its groups, and what each column holds. */
const listColumns: Record<string, { group?: string; groupMeaning?: string; meaning: string }> = {
  location: { group: 'Level', groupMeaning: 'Who sees it', meaning: 'What it covers' },
  category: { meaning: 'What it covers' },
  market_subject: {
    group: 'Kind',
    groupMeaning: 'How settlement reads it',
    meaning: 'What its data slot measures',
  },
};

function listTable(name: string): string {
  const defs = files.get('lists.schema.json')?.$defs as Record<string, Node> | undefined;
  const list = defs?.[name];
  const columns = listColumns[name];
  if (!list || !columns) throw new Error(`No shared list called ${name}`);
  const groups: Node[] = Array.isArray(list.anyOf)
    ? (list.anyOf as Node[]).map((ref) => resolve(String(ref.$ref), 'lists.schema.json').node)
    : [list];
  const head = columns.group
    ? `| Code | Name | ${columns.group} | ${columns.meaning} |`
    : `| Code | Name | ${columns.meaning} |`;
  const lines = [head, columns.group ? '|---|---|---|---|' : '|---|---|---|'];
  for (const group of groups) {
    for (const item of group.oneOf as Node[]) {
      const level = columns.group ? ` ${cell(String(group.title))} |` : '';
      lines.push(
        `| ${code(item.const)} | ${cell(String(item.title))} |${level} ${cell(String(item.description))} |`,
      );
    }
  }
  if (columns.group) {
    lines.push('', `| ${columns.group} | ${columns.groupMeaning} |`, '|---|---|');
    for (const group of groups)
      lines.push(`| ${cell(String(group.title))} | ${cell(String(group.description))} |`);
  }
  for (const group of groups) {
    if (typeof group.$comment === 'string') lines.push('', `Note: ${group.$comment}`);
  }
  return lines.join('\n');
}

function example(file: string, id: string): string {
  const records = JSON.parse(readFileSync(`${root}examples/${file}`, 'utf8')) as Node[];
  const record = records.find((r) => r.id === id);
  if (!record) throw new Error(`No example ${id} in examples/${file}`);
  return ['```json', JSON.stringify(record, null, 2), '```'].join('\n');
}

const BLOCK = /<!-- generated: (.+?) -->\n[\s\S]*?<!-- end generated -->/g;

/** The README with every generated part rewritten from the definitions and examples. */
export function renderReadme(readme: string): string {
  return readme.replace(BLOCK, (_, spec: string) => {
    const [kind = '', a = '', b = ''] = spec.split(' ');
    const body =
      kind === 'fields'
        ? fieldTable(a)
        : kind === 'list'
          ? listTable(a)
          : kind === 'example'
            ? example(a, b)
            : (() => {
                throw new Error(`Unknown generated part: ${spec}`);
              })();
    return `<!-- generated: ${spec} -->\n${body}\n<!-- end generated -->`;
  });
}

export const readmePath = `${root}README.md`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const before = readFileSync(readmePath, 'utf8');
  const after = renderReadme(before);
  if (after !== before) writeFileSync(readmePath, after);
  console.log(
    after === before ? 'agreement/README.md was already current.' : 'agreement/README.md updated.',
  );
}
