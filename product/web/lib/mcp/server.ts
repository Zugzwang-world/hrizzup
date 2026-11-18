import { randomUUID } from 'node:crypto';
import { contract, isPublished, procedures } from '@hrizzup/api';
import { type CallToolResult, createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { createRouterClient, ORPCError } from '@orpc/server';
import { z } from 'zod';
import { credentialOf } from '@/lib/api/credential.ts';
import { router } from '@/lib/api/router.ts';
import { keyAccess } from '@/lib/api/trading.ts';
import { currentEnvironment } from '@/lib/env.ts';

/**
 * The remote MCP server (PLAN.md step 3.5f; docs/research/public-api.md, section 2.10), at
 * `/api/v1/mcp` on staging, the demo: Claude Code, Codex, Cursor and any other MCP client connect over
 * HTTP with the same API keys bots use (`Authorization: Bearer <key>`), stateless, on the official
 * SDK (`@modelcontextprotocol/server`, MCP's 2026-07-28 revision and the 2025 ones before it).
 *
 * - **Its tools come from the contract:** one for each published call (not the console's, the app's
 *   sign-in or the keys' own, nor a call not live yet or kept out of MCP with `mcp: false`), named by
 *   its path (`markets_quote`, `markets_trade`), described by its summary (a call in beta starts
 *   with "(beta)"), taking the call's own input. Each runs that very call in-process, through the API's own
 *   handlers, so every rule (the key's scope, the limits, the books' checks, the exact decimals) is the
 *   API's, never copied here.
 * - **A key's kind decides which tools exist:** none sent, the public reads only; a read-only key,
 *   every read (its balance, positions, orders and trades too); a trading key, every market tool; an
 *   agent's posting key, the public reads and social's own tools. A social call's `who` (its meta)
 *   adds to it: `anyone`'s calls are every key's and no key's, an `agent`'s only the posting key's. A
 *   key that isn't valid is refused (401) before anything runs.
 * - **Only the key, never a cookie:** the tools act with the request's `Authorization` header, and the
 *   address it came from (`x-real-ip`, which Vercel sets: the limits on a visitor, such as registration's,
 *   count by it, and it carries no identity), and no other header; a request from another site's page
 *   (its `Origin`) is refused, so a browser's own session can never be used through it. The key is never
 *   passed on to anyone.
 * - **Trading tools take a request ID too,** a UUID of the caller's, so a retry never trades twice;
 *   when an AI tool leaves it out, the server makes one.
 * - **One message a request,** at most 64 KB: a JSON-RPC batch is refused, so no request carries more
 *   than one tool call past the firewall's requests a minute from each address.
 * - **Not on production** until its API opens at launch (5.2): there it answers "not found".
 */

export type Access = 'public' | 'read' | 'trade' | 'post';

type Procedure = ReturnType<typeof procedures>[number][1];

/** What each of the published calls is, as a tool. */
export type ToolSpec = {
  name: string;
  path: string[];
  /** The call's summary, starting with "(beta)" for a call in beta. */
  summary: string;
  /** The call is in beta. */
  beta: boolean;
  /** A reading call (GET) or a trading one (POST). */
  reads: boolean;
  /** A public read, the same for everyone, needing no key. */
  isPublic: boolean;
  /** Who a social call is for (its meta): `anyone`, or only an `agent` with its posting key. Unset on every market call. */
  who?: 'anyone' | 'agent';
  procedure: Procedure;
};

/**
 * The published calls of a contract but `health` as tools, in its own order: never a call not live
 * yet (`isPublished`) or kept out of MCP (`mcp: false`).
 */
export function toolsOf(router: object): ToolSpec[] {
  return procedures(router)
    .map(([name, procedure]) => ({ path: name.split('.'), procedure }))
    .filter(
      ({ path, procedure }) =>
        isPublished(path, procedure) &&
        path[0] !== 'health' &&
        procedure['~orpc'].meta.mcp !== false,
    )
    .map(({ path, procedure }) => {
      const beta = procedure['~orpc'].meta.beta === true;
      const summary = procedure['~orpc'].route.summary ?? path.join('.');
      const who = procedure['~orpc'].meta.who;
      return {
        name: path.join('_'),
        path,
        summary: beta ? `(beta) ${summary}` : summary,
        beta,
        reads: procedure['~orpc'].route.method === 'GET',
        isPublic: procedure['~orpc'].meta.caching.kind === 'public',
        ...(who === undefined ? {} : { who }),
        procedure,
      };
    });
}

/** The published calls but `health`, as tools, in the contract's own order. */
export const TOOLS: readonly ToolSpec[] = toolsOf(contract);

/**
 * The tools an access may see (of `tools`, the published calls). `who` comes first: an `agent`'s tool
 * is only the posting key's, an `anyone`'s tool is everyone's, a key or none. The rest follow the
 * market API's rule, a posting key counting as none: the public reads.
 */
export function toolsFor(access: Access, tools: readonly ToolSpec[] = TOOLS): ToolSpec[] {
  return tools.filter((tool) => {
    if (tool.who === 'agent') return access === 'post';
    if (tool.who === 'anyone') return true;
    if (access === 'trade') return true;
    if (access === 'read') return tool.reads;
    return tool.reads && tool.isPublic;
  });
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
- Amounts, shares, probabilities and prices are exact decimal text ("25", "0.42"), never numbers; times are ISO 8601 in UTC, always with three decimals, e.g. "2026-11-09T06:30:00.000Z".
- A market's probability is the chance of Yes. Quote before trading: markets_quote shows exactly what a trade would do, writing nothing.
- Every trade takes a requestId, a new UUID of your own: send the same one again to retry safely, and it never trades twice.
- Perp orders fill at the next price, about every 5 seconds, so they answer within seconds.
- Lists page with limit and cursor (the next of the page before). Docs: https://staging.hrizzup.com/docs
- Social (beta): an agent calls social_basics, the skill file, first; agent tools need its posting key.`;

/** What a tool says about who may use it. */
export function describedUse(tool: ToolSpec): string {
  if (tool.who === 'agent') return "Your agent's own: needs its posting key.";
  if (tool.isPublic) return 'Public: needs no key.';
  if (tool.who === 'anyone') return 'Anyone: needs no key.';
  return tool.reads ? 'Your own: needs a key.' : 'Trades play money: needs a trading key.';
}

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

/**
 * A fresh MCP server with the tools `access` may use, each acting with `headers` (`toolHeaders`: the key and
 * the address, nothing else). `url`
 * is the request's own address, given to every call as an HTTP call's is (a call that writes a link to
 * the site, an agent's claim link, takes its origin from it).
 */
export function mcpServer(access: Access, headers: Headers, url?: string): McpServer {
  const server = new McpServer(
    { name: 'hrizzup', title: 'Hrizzup (staging, the demo)', version: '1.0.0' },
    { instructions: INSTRUCTIONS },
  );
  const client = createRouterClient(router, {
    context: () => ({ headers, resHeaders: new Headers(), ...(url === undefined ? {} : { url }) }),
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
        description: `${tool.summary}. ${describedUse(tool)}${takesRequest ? ' Send a new requestId (a UUID) of your own to retry safely; left out, the server makes one.' : ''} The API's call ${tool.path.join('.')}: https://staging.hrizzup.com/docs/calls/${tool.path.join('.')}`,
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

/**
 * The headers a tool's call is given, of a request's: its `Authorization` and `x-real-ip`, and none other, so
 * no cookie or other credential of the request reaches a call. The address is the one header `ipAddress()`
 * (`@vercel/functions`) reads, which every limit on a visitor (L2 new agents, L3 refused invite codes, L4 claim
 * links looked at) counts by: left off, a registration over MCP would count for nobody. Vercel sets it
 * itself, whatever the request sent; it names no one.
 */
export function toolHeaders(from: Headers): Headers {
  const headers = new Headers();
  for (const name of ['authorization', 'x-real-ip']) {
    const value = from.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
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
 * Which tools a request may use, by its key: none sent, the public reads; else the key's own kind
 * (`read`, `trade`, or an agent's `post`). A refusal (as the API's answer) for a key that isn't valid, a sign-in session, or another site.
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
    return await keyAccess(
      new Headers({ authorization: request.headers.get('authorization') ?? '' }),
    );
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
  // The tools act with the key and the request's address alone: no cookie, no other header of the request's.
  const headers = toolHeaders(request.headers);
  const handler = createMcpHandler(() => mcpServer(access, headers, request.url), {
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
