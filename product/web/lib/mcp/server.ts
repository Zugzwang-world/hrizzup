import { randomUUID } from 'node:crypto';
import { contract, isPublished, procedures } from '@hrizzup/api';
import { type CallToolResult, createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { createRouterClient, ORPCError } from '@orpc/server';
import { z } from 'zod';
import { credentialOf } from '@/lib/api/credential.ts';
import { router } from '@/lib/api/router.ts';
import { person } from '@/lib/api/trading.ts';
import { currentEnvironment } from '@/lib/env.ts';

/**
 * The remote MCP server (PLAN.md step 3.5f; docs/research/public-api.md, section 2.10), at
 * `/api/v1/mcp` on staging, the demo: Claude Code, Codex, Cursor and any other MCP client connect over
 * HTTP with the same API keys bots use (`Authorization: Bearer <key>`), stateless, on the official
 * SDK (`@modelcontextprotocol/server`, MCP's 2026-07-28 revision and the 2025 ones before it).
 *
 * - **Its tools come from the contract:** one for each published call (not the console's, the app's
 *   sign-in or the keys' own), named by its path (`markets_quote`, `markets_trade`), described by its
 *   summary, taking the call's own input. Each runs that very call in-process, through the API's own
 *   handlers, so every rule (the key's scope, the limits, the books' checks, the exact decimals) is the
 *   API's, never copied here.
 * - **A key's scope decides which tools exist:** none sent, the public reads only; a read-only key,
 *   every read (its balance, positions, orders and trades too); a trading key, every tool. A key that
 *   isn't valid is refused (401) before anything runs.
 * - **Only the key, never a cookie:** the tools act with the request's `Authorization` header alone;
 *   a request from another site's page (its `Origin`) is refused, so a browser's own session can never
 *   be used through it. The key is never passed on to anyone.
 * - **Trading tools take a request ID too,** a UUID of the caller's, so a retry never trades twice;
 *   when an AI tool leaves it out, the server makes one.
 * - **One message a request,** at most 64 KB: a JSON-RPC batch is refused, so no request carries more
 *   than one tool call past the firewall's requests a minute from each address.
 * - **Not on production** until its API opens at launch (5.2): there it answers "not found".
 */

export type Access = 'public' | 'read' | 'trade';

type Procedure = ReturnType<typeof procedures>[number][1];

/** What each of the published calls is, as a tool. */
export type ToolSpec = {
  name: string;
  path: string[];
  summary: string;
  /** A reading call (GET) or a trading one (POST). */
  reads: boolean;
  /** A public read, the same for everyone, needing no key. */
  isPublic: boolean;
  procedure: Procedure;
};

/** The published calls but `health`, as tools, in the contract's own order. */
export const TOOLS: readonly ToolSpec[] = procedures(contract)
  .map(([name, procedure]) => ({ path: name.split('.'), procedure }))
  .filter(({ path }) => isPublished(path) && path[0] !== 'health')
  .map(({ path, procedure }) => ({
    name: path.join('_'),
    path,
    summary: procedure['~orpc'].route.summary ?? path.join('.'),
    reads: procedure['~orpc'].route.method === 'GET',
    isPublic: procedure['~orpc'].meta.caching.kind === 'public',
    procedure,
  }));

/** The tools a scope may see. */
export function toolsFor(access: Access): ToolSpec[] {
  return TOOLS.filter((tool) =>
    access === 'trade' ? true : access === 'read' ? tool.reads : tool.reads && tool.isPublic,
  );
}

type AnySchema = z.ZodType;

/** A schema without its `.optional()` wrappers. */
function unwrap(schema: AnySchema): AnySchema {
  let at = schema;
  while (at instanceof z.ZodOptional) at = at.unwrap() as AnySchema;
  return at;
}

/**
 * A call's input as a tool's: an object, as MCP asks. A list's optional page becomes its two optional
 * fields; a choice of shapes (a buy or a sale, each in v1's form and Manifold's) becomes one object
 * whose discriminator lists them, each field the widest form's, optional unless every shape has it;
 * a request ID optional (the server makes one). The call itself checks the input again, exactly,
 * with the contract's own schema.
 */
export function toolInput(schema: unknown): z.ZodObject {
  const at = unwrap((schema ?? z.object({})) as AnySchema);
  let shape: Record<string, AnySchema>;
  if (at instanceof z.ZodDiscriminatedUnion || at instanceof z.ZodUnion) {
    const options = (at.options as AnySchema[]).map(unwrap) as z.ZodObject[];
    const keys = [...new Set(options.flatMap((option) => Object.keys(option.shape)))];
    shape = {};
    for (const key of keys) {
      const schemas = options
        .map((option) => option.shape[key] as AnySchema | undefined)
        .filter((one): one is AnySchema => one !== undefined);
      const everywhere = schemas.length === options.length;
      if (schemas.every((one) => one instanceof z.ZodLiteral)) {
        // A discriminator (a buy or a sale): one of its values.
        const values = schemas.flatMap((one) => [...(one as z.ZodLiteral).values].map(String));
        const choice = z.enum([...new Set(values)] as [string, ...string[]]);
        shape[key] = everywhere ? choice : choice.optional();
      } else {
        // Otherwise the last choice's: v1's own forms come first, the wider ones (Manifold's
        // `YES` and `NO`) after them.
        const widest = unwrap(schemas[schemas.length - 1] as AnySchema);
        shape[key] = everywhere ? widest : widest.optional();
      }
    }
  } else if (at instanceof z.ZodObject) {
    shape = { ...(at.shape as Record<string, AnySchema>) };
  } else {
    throw new Error('A tool takes an object');
  }
  if (shape.requestId) shape.requestId = unwrap(shape.requestId).optional();
  // Strict, as the contract's own inputs are: a field it doesn't know (`dry_run`, a mistyped
  // `limitProb`) is refused, never dropped, so a call never does less than it was asked.
  return z.strictObject(shape);
}

/** What the tools tell an AI tool about the whole API, once. */
const INSTRUCTIONS = `Hrizzup's demo on staging: play-money prediction markets and a Bitcoin perp (Ṁ, play money only).
- Amounts, shares, probabilities and prices are exact decimal text ("25", "0.42"), never numbers; times are ISO 8601 in UTC.
- A market's probability is the chance of Yes. Quote before trading: markets_quote shows exactly what a trade would do, writing nothing.
- Every trade takes a requestId, a new UUID of your own: send the same one again to retry safely, and it never trades twice.
- Perp orders fill at the next price, about every 5 seconds, so they answer within seconds.
- Lists page with limit and cursor (the next of the page before). Docs: https://staging.hrizzup.com/docs`;

/** A tool's answer: the call's answer as JSON text and as structured content, or its refusal. */
function answerOf(value: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>,
  };
}

function refusalOf(error: unknown): CallToolResult {
  const refusal =
    error instanceof ORPCError
      ? { code: error.code, status: error.status, message: error.message, data: error.data }
      : { code: 'INTERNAL_SERVER_ERROR', status: 500, message: 'Something went wrong' };
  return { content: [{ type: 'text', text: JSON.stringify(refusal, null, 2) }], isError: true };
}

/** A fresh MCP server with the tools `access` may use, each acting with `headers` (the key alone). */
export function mcpServer(access: Access, headers: Headers): McpServer {
  const server = new McpServer(
    { name: 'hrizzup', title: 'Hrizzup (staging, the demo)', version: '1.0.0' },
    { instructions: INSTRUCTIONS },
  );
  const client = createRouterClient(router, {
    context: () => ({ headers, resHeaders: new Headers() }),
  }) as unknown as Record<string, unknown>;
  for (const tool of toolsFor(access)) {
    const call = tool.path.reduce<unknown>(
      (at, part) => (at as Record<string, unknown>)[part],
      client,
    ) as (input: unknown) => Promise<unknown>;
    const inputSchema = toolInput(tool.procedure['~orpc'].inputSchema);
    const takesRequest = 'requestId' in inputSchema.shape;
    server.registerTool(
      tool.name,
      {
        title: tool.summary,
        description: `${tool.summary}. ${tool.isPublic ? 'Public: needs no key.' : tool.reads ? 'Your own: needs a key.' : 'Trades play money: needs a trading key.'}${takesRequest ? ' Send a new requestId (a UUID) of your own to retry safely; left out, the server makes one.' : ''} The API's call ${tool.path.join('.')}: https://staging.hrizzup.com/docs/calls/${tool.path.join('.')}`,
        inputSchema,
        annotations: {
          title: tool.summary,
          readOnlyHint: tool.reads,
          destructiveHint: false,
          idempotentHint: tool.reads || takesRequest,
          openWorldHint: false,
        },
      },
      async (args: Record<string, unknown>) => {
        const input = takesRequest && !args.requestId ? { ...args, requestId: randomUUID() } : args;
        try {
          return answerOf(await call(input));
        } catch (error) {
          return refusalOf(error);
        }
      },
    );
  }
  return server;
}

/** The largest message the server reads: tools' inputs are a few fields each. */
const MOST_BODY = 64 * 1024;

/**
 * A request's body as text, read as it streams in and given up (null) the moment it passes `most`
 * bytes, whatever length it declared, so nothing larger is ever held.
 */
async function readAtMost(request: Request, most: number): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > most) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function refused(status: number, code: string, message: string): Response {
  return Response.json(
    { defined: false, code, status, message },
    { status, headers: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' } },
  );
}

/**
 * Which tools a request may use, by its key: none sent, the public reads; else the key's own scope.
 * A refusal (as the API's answer) for a key that isn't valid, a sign-in session, or another site.
 */
export async function accessFor(request: Request): Promise<Access | Response> {
  const origin = request.headers.get('origin');
  if (origin !== null && origin !== new URL(request.url).origin) {
    return refused(
      403,
      'FORBIDDEN',
      'The MCP server takes requests from AI tools, not from other sites',
    );
  }
  const credential = credentialOf(request.headers);
  if (credential.kind === 'none') return 'public';
  if (credential.kind === 'token') {
    return refused(
      401,
      'UNAUTHORIZED',
      'The MCP server takes an API key: Authorization: Bearer <key>',
    );
  }
  try {
    const who = await person(
      new Headers({ authorization: request.headers.get('authorization') ?? '' }),
      'read',
    );
    return who.key?.scope === 'trade' ? 'trade' : 'read';
  } catch (error) {
    if (error instanceof ORPCError) return refused(error.status, error.code, error.message);
    throw error;
  }
}

/** Serves one MCP request: stateless, a fresh server with the tools its key may use. */
export async function serveMcp(request: Request): Promise<Response> {
  if (currentEnvironment() === 'production') {
    return refused(404, 'NOT_FOUND', "The MCP server opens with production's API, at launch");
  }
  const access = await accessFor(request);
  if (access instanceof Response) return access;
  // One message a request: a JSON-RPC batch (an array) would carry many tool calls past the
  // firewall's requests a minute from each address, so it's refused, as MCP's current revision
  // dropped batches anyway. And a message is small: at most 64 KB.
  let parsedBody: unknown;
  if (request.method === 'POST') {
    const declared = Number(request.headers.get('content-length') ?? 0);
    const text = declared > MOST_BODY ? null : await readAtMost(request, MOST_BODY);
    if (text === null) return refused(413, 'PAYLOAD_TOO_LARGE', 'At most 64 KB a message');
    try {
      parsedBody = JSON.parse(text);
    } catch {
      return refused(400, 'BAD_REQUEST', 'A message is JSON');
    }
    if (Array.isArray(parsedBody)) {
      return refused(400, 'BAD_REQUEST', 'One message a request: batches are not taken');
    }
  }
  // The tools act with the key alone: no cookie, no other header of the request's.
  const authorization = request.headers.get('authorization');
  const headers = new Headers(authorization ? { authorization } : {});
  const handler = createMcpHandler(() => mcpServer(access, headers), {
    legacy: 'stateless',
    responseMode: 'json',
  });
  const response = await handler.fetch(
    request,
    parsedBody === undefined ? undefined : { parsedBody },
  );
  const answer = new Headers(response.headers);
  answer.set('Cache-Control', 'private, no-store');
  answer.set('X-Robots-Tag', 'noindex');
  return new Response(response.body, { status: response.status, headers: answer });
}
