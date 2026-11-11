import { serveMcp } from '@/lib/mcp/server.ts';

/**
 * The remote MCP server (PLAN.md step 3.5f; lib/mcp/server.ts): Claude Code, Codex and Cursor connect
 * here with an API key. Under `/api/v1/`, so staging's firewall rules for the API (60 requests a
 * minute from each address, no bot challenge for tools that aren't browsers) cover it as they are.
 * Stateless: each POST is one message; GET and DELETE (the older revisions' session calls) answer
 * 405.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = serveMcp;
export const GET = serveMcp;
export const DELETE = serveMcp;
