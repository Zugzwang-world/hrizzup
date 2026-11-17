import { oc } from '@orpc/contract';
import { z } from 'zod';
import { commonErrors } from './paging.ts';

/**
 * What every call of the contract is built from, in one module so the contract's files (the market
 * API's, `contract.ts`, and social's, one per area under `social/`) share one set of builders and
 * can't import each other: `call` for an ordinary call, `admin` for a console call, the meta every
 * call carries, and the input of a call that takes none.
 */

/**
 * How a call's answer may be kept (blueprint section 14, "Caching in layers"). Every call says
 * which, here in the contract; the website's handler turns it into headers. Anything personal
 * is never kept by anyone but the person's own device, and only while it's open.
 */
export type Caching =
  | {
      kind: 'public';
      /** How long Vercel's edge serves its copy before asking again. */
      edgeSeconds: number;
      /** How long after that the edge may still serve its copy while it fetches a new one. */
      staleSeconds: number;
      /** Cache tags, so a change can clear every copy at once (Vercel-Cache-Tag). */
      tags: readonly string[];
    }
  | { kind: 'personal' };

export type Meta = {
  caching: Caching;
  /**
   * The call sends email. Such a call is a POST under `/auth/email/`, so the firewall's limit on
   * everything that sends email covers it (`/api/v1/auth/email/`: 5 requests a minute per visitor,
   * infra/vercel/firewall.json); the contract's tests hold every one to it.
   */
  sendsEmail?: true;
  /**
   * The call is in beta (every social call outside the console, while social is built): the OpenAPI
   * file marks it `x-stability-level: beta`, the docs show "Beta", MCP's tool summary starts with
   * "(beta)", and the breaking-change check leaves it out, so it may change in v1. A call without
   * it is v1, as every call is today; the check refuses a call that gains it
   * (.github/scripts/api_breaking.py). Removed from every call when social leaves beta.
   */
  beta?: true;
  /**
   * The call is in the contract but its back end isn't built yet: never in the OpenAPI file, the
   * docs or MCP's tools, and the website answers it exactly as an address the API doesn't have
   * ("No such call", 404). Removed from a call when its back end lands.
   */
  live?: false;
  /**
   * Who a social call is for: `anyone` (a person, or an agent, within the call's own rules) or only
   * an `agent` (with its posting key). MCP's tools follow it (R6). Unset on every market-API call, and
   * on social's owner, reader and `admin.social` calls too, which are never published and so never
   * MCP tools: only the calls under `social.*` carry it.
   */
  who?: 'anyone' | 'agent';
  /** The call is never an MCP tool, though it stays in the OpenAPI file and the docs. */
  mcp?: false;
};

/**
 * Every call starts personal (never cached); a public read says so itself. Every call may answer the
 * common errors (paging.ts): a refused input (400, each problem in `data.issues`) and "try again in
 * a moment" (503); each adds its own below.
 */
export const call = oc.$meta<Meta>({ caching: { kind: 'personal' } }).errors(commonErrors);

/**
 * What the console's calls may answer an admin: no such market or perp, a request that clashes with
 * the market's or perp's state, besides the common errors. To anyone else, each answers exactly as
 * an address the API doesn't have ("No such call", 404).
 */
export const consoleErrors = {
  NOT_FOUND: { status: 404, message: 'No such market' },
  CONFLICT: { status: 409, message: "That doesn't fit the market's state" },
} as const;
export const admin = call.errors(consoleErrors);

/**
 * A call that takes no input at all. Anything sent is refused (400), so a stray or random query
 * can't slip past the checks or split the edge's cache into copies nobody asked for.
 */
export const noInput = z.strictObject({}).optional();
