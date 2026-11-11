import { type Block, guide, site } from './guide.ts';
import { type Call, calls, type Field, server, title, version } from './reference.ts';

/**
 * The public API's docs as Markdown, for AI tools (PLAN.md step 3.5a): llms.txt, the short guide in
 * the llmstxt.org format, and llms-full.txt, the whole docs page as text. Both are made from the
 * same guides and the same OpenAPI file as the docs page, so they can't drift from it.
 */

function block(b: Block): string {
  switch (b.kind) {
    case 'p':
      return b.text;
    case 'list':
      return b.items.map((item) => `- ${item}`).join('\n');
    case 'code':
      return `\`\`\`sh\n${b.text}\n\`\`\``;
    case 'table':
      return [
        `| ${b.head.join(' | ')} |`,
        `| ${b.head.map(() => '---').join(' | ')} |`,
        ...b.rows.map((row) => `| ${row.join(' | ')} |`),
      ].join('\n');
  }
}

function fields(heading: string, list: Field[]): string {
  if (list.length === 0) return '';
  const rows = list.map(
    (f) =>
      `- \`${f.name}\`${f.required ? '' : ' (optional)'}: ${f.kind}${f.note ? `. ${f.note}` : ''}`,
  );
  return `${heading}\n\n${rows.join('\n')}`;
}

function call(c: Call): string {
  const parts = [
    `### ${c.method} ${c.path}`,
    `${c.summary}. ${c.needsKey ? 'Needs your key.' : 'Public: no key.'} (\`${c.id}\`)`,
    fields('Path:', c.takes.path),
    fields('Query:', c.takes.query),
    ...c.takes.body.map((variant) =>
      fields(variant.when ? `Body, when ${variant.when}:` : 'Body (JSON):', variant.fields),
    ),
    fields('Answers:', c.answers),
    c.errors.length
      ? `Errors:\n\n${c.errors.map((e) => `- ${e.status} \`${e.code}\`: ${e.message}`).join('\n')}`
      : '',
  ];
  return parts.filter(Boolean).join('\n\n');
}

/** The whole docs page as Markdown. */
export function fullText(): string {
  return [
    `# ${title} (v${version}): the demo, on staging`,
    `> Hrizzup's API for bots and AI tools, at ${server}. Play money, keys that work only on staging, data that may be reset.`,
    ...guide.map((section) => [`## ${section.title}`, ...section.blocks.map(block)].join('\n\n')),
    '## Every call',
    ...calls.map(call),
  ]
    .join('\n\n')
    .concat('\n');
}

/** llms.txt, in the llmstxt.org format: a name, a summary, and links with a line each. */
export function llmsText(): string {
  return `# ${title}

> Hrizzup's API for bots and AI tools: play-money prediction markets and a Bitcoin perp, with the same calls Hrizzup's own website and app use. This is the demo, on staging: play money only, keys that work only here, and data that may be reset (with notice in the changelog). Production's API opens at launch.

Public reads (markets, perps, prices) need no key. Your own balance, positions and orders, and trading, need a personal key, sent as \`Authorization: Bearer <key>\`, made on ${site}/sandbox/keys after signing in. Amounts are exact decimal text, times ISO 8601; lists page with \`limit\` and \`cursor\`; every refusal is \`{ defined, code, status, message, data }\`.

## Docs

- [The API's docs](${site}/docs): the demo, your first call, the ground rules, moving from Manifold, and every call
- [The docs as text](${site}/llms-full.txt): the same, in Markdown, for reading whole
- [OpenAPI file](${server}/openapi.json): OpenAPI 3.1, made from the contract the website and app use
- [MCP server](${server}/mcp): Streamable HTTP, the API as tools for Claude Code, Codex and Cursor; send your key as \`Authorization: Bearer <key>\` (setup: ${site}/docs/ai-tools)

## Optional

- [Make an API key](${site}/sandbox/keys): read-only or trading, shown once, revocable (sign in first)
`;
}
