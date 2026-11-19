import { chmodSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { social } from '@hrizzup/api';
import { ADMIN_TEST_ACCOUNT } from '../../e2e/support/test-accounts.ts';
import { readyMessage } from '../../lib/api/social/admin.ts';
import { STAGING_ORIGIN } from '../../lib/auth-relay.ts';
import type { Auth, Ctx } from './context.ts';
import { freshEntry, keyFile, MEMBERS, type MemberKey, readCast, writeCast } from './members.ts';
import { makeOutput, type Output } from './redact.ts';
import { readState, writeState } from './state.ts';
import { Store } from './store.ts';

/**
 * What the cast's tests stand on, with no network and no real clock: a fake clock whose sleeps
 * only move time, a fake staging that answers like the API (with its request-ID rule: the same ID
 * and body replays, the same ID with another body is 409 `request_reused`), secret-shaped values
 * built at run time (never written out whole, so the secret check has nothing to flag), and a
 * temporary store. Never imported by the command itself.
 */

// ---------------------------------------------------------------------------------------------
// Values that look like secrets and are nothing: low entropy, built from parts
// ---------------------------------------------------------------------------------------------

const letter = (n: number) => String.fromCharCode(97 + (n % 26));

/** A posting key's shape: `hz_demo_` and 43 letters. */
export const fakeKey = (n: number) => ['hz', 'demo', letter(n).repeat(43)].join('_');
/** An invite code's shape: `hz-` and four groups of four. */
export const fakeCode = (n: number) =>
  [
    'hz',
    letter(n).repeat(4),
    letter(n + 1).repeat(4),
    letter(n + 2).repeat(4),
    letter(n + 3).repeat(4),
  ].join('-');
/** A claim link's token: 43 letters. */
export const fakeToken = (n: number) => letter(n + 5).repeat(43);
/** A JWT's shape. */
export const fakeJwt = (n: number) =>
  [`eyJ${letter(n).repeat(20)}`, letter(n).repeat(24), letter(n).repeat(24)].join('.');
/** A service key's shape. */
export const fakeServiceKey = () => ['sb', 'secret', 'x'.repeat(24)].join('_');
/** A signed upload address's shape (R2, path-style, a query that carries a signature). */
export const fakeUploadUrl = (
  bucket = 'hrizzup-staging-uploads',
  host = 'example-account.r2.cloudflarestorage.com',
) =>
  `https://${host}/${bucket}/social/${idOf(900)}/${idOf(901)}?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=600&X-Amz-Signature=${'0'.repeat(16)}`;

/** A version 7 style ID from a counter. */
export const idOf = (n: number) => `01900000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;

// ---------------------------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------------------------

export function fakeClock(start = Date.parse('2026-11-19T10:00:00.000Z')) {
  let now = start;
  const sleeps: number[] = [];
  return {
    now: () => now,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      now += ms;
    },
    sleeps,
    advance(ms: number) {
      now += ms;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// A fake staging
// ---------------------------------------------------------------------------------------------

export type Req = {
  method: string;
  url: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
  bearer: string | null;
  init: RequestInit;
};

export type Res = {
  status: number;
  body?: unknown;
  text?: string;
  headers?: Record<string, string>;
};

type Handler = (req: Req, match: RegExpExecArray) => Res | Promise<Res>;

export const json = (status: number, body: unknown, headers?: Record<string, string>): Res => ({
  status,
  body,
  ...(headers ? { headers } : {}),
});

export const refusal = (status: number, code: string, reason?: string, extra: object = {}): Res =>
  json(status, {
    code,
    status,
    message: `${code}: see data.reason`,
    data: reason ? { reason, ...extra } : { ...extra },
  });

export class FakeServer {
  requests: Req[] = [];
  /** Every address anything was sent to that was not staging's API or an upload bucket. */
  strays: string[] = [];
  puts: Array<{ url: string; headers: Record<string, string>; bytes: number }> = [];
  private routes: Array<{ method: string; pattern: RegExp; handler: Handler }> = [];
  /** The nth API request (counted from 0 once this is set) and every one after it fails with no answer; with `apply`, the nth is carried out first. */
  fault: { at: number; apply: boolean } | null = null;
  private seen = 0;
  /** What an upload bucket answers a PUT. */
  putStatus = 200;
  onPut: ((url: string) => void) | null = null;
  /** Called with each API request as it arrives, before it is answered. */
  onRequest: ((req: Req) => void) | null = null;

  on(method: string, pattern: RegExp | string, handler: Handler): void {
    const regex = typeof pattern === 'string' ? new RegExp(`^${pattern}$`) : pattern;
    this.routes.unshift({ method, pattern: regex, handler });
  }

  /** The requests whose path matches, in order. */
  to(method: string, pattern: RegExp): Req[] {
    return this.requests.filter((req) => req.method === method && pattern.test(req.path));
  }

  fetch: typeof fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    if (url.hostname.endsWith('.r2.cloudflarestorage.com')) {
      const headers = Object.fromEntries(new Headers(init.headers).entries());
      const bytes = (init.body as Uint8Array | undefined)?.length ?? 0;
      this.puts.push({ url: url.toString(), headers, bytes });
      this.onPut?.(url.toString());
      return new Response(null, { status: this.putStatus });
    }
    if (url.origin !== STAGING_ORIGIN) {
      this.strays.push(url.toString());
      throw new TypeError('not staging');
    }
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const authorization = headers.authorization ?? '';
    let body: Record<string, unknown> | null = null;
    if (typeof init.body === 'string') body = JSON.parse(init.body) as Record<string, unknown>;
    const req: Req = {
      method,
      url: url.toString(),
      path: url.pathname,
      query: url.searchParams,
      headers,
      body,
      bearer: /^Bearer (.+)$/.exec(authorization)?.[1] ?? null,
      init,
    };
    this.requests.push(req);
    this.onRequest?.(req);
    const index = this.seen++;
    if (this.fault && index >= this.fault.at) {
      if (index === this.fault.at && this.fault.apply) await this.answer(req);
      throw new TypeError('fetch failed');
    }
    const res = await this.answer(req);
    const text = res.text ?? (res.body === undefined ? '' : JSON.stringify(res.body));
    return new Response(text, {
      status: res.status,
      headers: {
        ...(res.text === undefined ? { 'content-type': 'application/json' } : {}),
        ...res.headers,
      },
    });
  };

  private async answer(req: Req): Promise<Res> {
    for (const route of this.routes) {
      if (route.method !== req.method) continue;
      const match = route.pattern.exec(req.path);
      if (match) return route.handler(req, match);
    }
    return refusal(404, 'NOT_FOUND');
  }
}

/** The real inputs of the contract, strict as they are: a body the cast sends must pass them. */
export function inputProblems(
  schema: { safeParse: (value: unknown) => { success: boolean; error?: { issues: unknown[] } } },
  value: unknown,
): string | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? null : JSON.stringify(parsed.error?.issues ?? []);
}

type Invite = {
  id: string;
  email: string;
  note: string | null;
  house: boolean;
  listed: boolean;
  code: string;
  usedAt: string | null;
  revokedAt: string | null;
  agentId: string | null;
};

type Agent = {
  id: string;
  handle: string;
  name: string;
  bio: string | null;
  state: 'waiting' | 'claimed' | 'retired';
  house: boolean;
  inviteId: string;
  keys: Set<string>;
  token: string;
};

/**
 * The staging calls `make`, `retire` and the story loads use, as the API behaves: the same ID with the same
 * body is a retry (an invite answers a fresh code, a registration a fresh key and link), with another body
 * 409 `request_reused`. Bodies are checked with the contract's own strict inputs.
 */
export class FakeSocial {
  invites = new Map<string, Invite>();
  agents = new Map<string, Agent>();
  /** request ID -> what it was for and what it sent. */
  private done = new Map<string, { kind: string; sig: string; ref: string }>();
  tokens = new Map<string, string>();
  private counter = 1000;
  /** Every body that failed the contract's own input. */
  badBodies: string[] = [];
  now: () => string;

  constructor(server: FakeServer, now: () => string) {
    this.now = now;
    server.on('GET', '/skill.md', () => ({
      status: 200,
      text: `<!-- part basics, revision 2, 2026-11-19, check 453241dc -->\n# Hrizzup: a guide for agents\ncurl ${STAGING_ORIGIN}/api/v1/social/agents\n<!-- part agents, revision 3, 2026-11-19, check 81bd1717 -->\n`,
      headers: { 'content-type': 'text/markdown' },
    }));
    server.on('POST', '/api/v1/admin/social/invites', (req) => this.createInvite(req));
    server.on('GET', '/api/v1/admin/social/invites', () =>
      json(200, {
        invites: [...this.invites.values()].reverse().map((invite) => this.inviteOf(invite)),
        next: null,
      }),
    );
    server.on(
      'POST',
      /^\/api\/v1\/admin\/social\/invites\/([0-9a-f-]{36})\/revoke$/,
      (req, match) => this.revokeInvite(req, match[1] ?? ''),
    );
    server.on('GET', '/api/v1/admin/social/agents', () =>
      json(200, {
        agents: [...this.agents.values()].map((agent) => ({
          id: agent.id,
          handle: agent.handle,
          state: agent.state,
        })),
        next: null,
      }),
    );
    server.on(
      'POST',
      /^\/api\/v1\/admin\/social\/agents\/([0-9a-f-]{36})\/revoke-keys$/,
      (req, match) => this.revokeKeys(req, match[1] ?? ''),
    );
    server.on('POST', '/api/v1/social/agents', (req) => this.register(req));
    server.on('GET', '/api/v1/social/me', (req) => this.me(req));
    server.on('POST', '/api/v1/owner/claims', (req) => this.claim(req));
  }

  private next(): number {
    return ++this.counter;
  }

  /** A session's token for an account (the admin's, or an owner's): one per account, kept. */
  tokenFor(email: string): string {
    for (const [token, owner] of this.tokens) if (owner === email) return token;
    const token = fakeJwt(this.next());
    this.tokens.set(token, email);
    return token;
  }

  private inviteOf(invite: Invite) {
    return {
      id: invite.id,
      email: invite.email,
      note: invite.note,
      house: invite.house,
      listed: invite.listed,
      codeShown: invite.code.slice(0, 7),
      usedAt: invite.usedAt,
      revokedAt: invite.revokedAt,
      agent: invite.agentId
        ? { id: invite.agentId, handle: this.agents.get(invite.agentId)?.handle }
        : null,
    };
  }

  private asAdmin(req: Req): Res | null {
    return this.tokens.get(req.bearer ?? '') === ADMIN_TEST_ACCOUNT
      ? null
      : refusal(404, 'NOT_FOUND');
  }

  private createInvite(req: Req): Res {
    const denied = this.asAdmin(req);
    if (denied) return denied;
    const problem = inputProblems(social.createInviteInput, req.body);
    if (problem) {
      this.badBodies.push(problem);
      return refusal(400, 'BAD_REQUEST');
    }
    const { requestId, ...rest } = req.body as { requestId: string } & Record<string, unknown>;
    const sig = JSON.stringify(rest);
    const before = this.done.get(requestId);
    let invite: Invite | undefined;
    if (before) {
      if (before.sig !== sig) return refusal(409, 'CONFLICT', 'request_reused');
      invite = this.invites.get(before.ref);
      if (invite?.usedAt) return refusal(409, 'CONFLICT', 'invite_used');
      if (invite?.revokedAt) return refusal(409, 'CONFLICT', 'invite_revoked');
      if (invite) invite.code = fakeCode(this.next());
    } else {
      const email = String(rest.email);
      for (const other of this.invites.values()) {
        if (other.email === email && !other.usedAt && !other.revokedAt) {
          return refusal(409, 'CONFLICT', 'invite_open');
        }
      }
      invite = {
        id: idOf(this.next()),
        email,
        note: (rest.note as string | undefined) ?? null,
        house: rest.house === true,
        listed: rest.listed === true,
        code: fakeCode(this.next()),
        usedAt: null,
        revokedAt: null,
        agentId: null,
      };
      this.invites.set(invite.id, invite);
      this.done.set(requestId, { kind: 'invite', sig, ref: invite.id });
    }
    if (!invite) return refusal(404, 'NOT_FOUND');
    return json(201, {
      invite: this.inviteOf(invite),
      code: invite.code,
      message: readyMessage(STAGING_ORIGIN, invite.code, invite.email),
    });
  }

  private retire(agent: Agent): void {
    agent.state = 'retired';
    agent.keys.clear();
  }

  private revokeInvite(req: Req, id: string): Res {
    const denied = this.asAdmin(req);
    if (denied) return denied;
    const problem = inputProblems(social.revokeInviteInput, { id, ...req.body });
    if (problem) {
      this.badBodies.push(problem);
      return refusal(400, 'BAD_REQUEST');
    }
    const invite = this.invites.get(id);
    if (!invite) return refusal(404, 'NOT_FOUND');
    const agent = invite.agentId ? this.agents.get(invite.agentId) : undefined;
    if (agent?.state === 'claimed') return refusal(409, 'CONFLICT', 'invite_claimed');
    invite.revokedAt ??= this.now();
    if (agent) this.retire(agent);
    return json(200, this.inviteOf(invite));
  }

  private revokeKeys(req: Req, id: string): Res {
    const denied = this.asAdmin(req);
    if (denied) return denied;
    const problem = inputProblems(social.revokeAgentKeysInput, { id, ...req.body });
    if (problem) {
      this.badBodies.push(problem);
      return refusal(400, 'BAD_REQUEST');
    }
    const agent = this.agents.get(id);
    if (!agent) return refusal(404, 'NOT_FOUND');
    agent.keys.clear();
    if ((req.body as { retire?: boolean }).retire) agent.state = 'retired';
    return json(200, { id: agent.id, handle: agent.handle, state: agent.state });
  }

  private register(req: Req): Res {
    const problem = inputProblems(social.registrationInput, req.body);
    if (problem) {
      this.badBodies.push(problem);
      return refusal(400, 'BAD_REQUEST');
    }
    const { requestId, inviteCode, ...rest } = req.body as {
      requestId: string;
      inviteCode: string;
    } & Record<string, unknown>;
    const sig = JSON.stringify({ inviteCode, ...rest });
    const invite = [...this.invites.values()].find((one) => one.code === inviteCode);
    if (!invite) return refusal(401, 'UNAUTHORIZED');
    if (invite.revokedAt) return refusal(422, 'REFUSED', 'invite_revoked');
    const before = this.done.get(requestId);
    let agent: Agent | undefined;
    let reissued = false;
    if (before) {
      if (before.sig !== sig) return refusal(409, 'CONFLICT', 'request_reused');
      agent = this.agents.get(before.ref);
      if (agent?.state === 'claimed') return refusal(409, 'CONFLICT', 'already_claimed');
      reissued = true;
    } else {
      if (invite.usedAt) return refusal(409, 'CONFLICT', 'invite_used');
      if ([...this.agents.values()].some((one) => one.handle === rest.handle)) {
        return refusal(409, 'CONFLICT', 'handle_taken');
      }
      agent = {
        id: idOf(this.next()),
        handle: String(rest.handle),
        name: String(rest.name),
        bio: (rest.bio as string | undefined) ?? null,
        state: 'waiting',
        house: invite.house,
        inviteId: invite.id,
        keys: new Set(),
        token: '',
      };
      this.agents.set(agent.id, agent);
      invite.usedAt = this.now();
      invite.agentId = agent.id;
      this.done.set(requestId, { kind: 'agent', sig, ref: agent.id });
    }
    if (!agent) return refusal(404, 'NOT_FOUND');
    agent.keys.clear();
    const secret = fakeKey(this.next());
    agent.keys.add(secret);
    agent.token = fakeToken(this.next());
    return json(201, {
      agent: {
        id: agent.id,
        handle: agent.handle,
        name: agent.name,
        state: 'waiting',
        house: agent.house,
      },
      key: { id: idOf(this.next()), name: 'First key', shown: secret.slice(0, 12) },
      secret,
      claimUrl: `${STAGING_ORIGIN}/sandbox/social/claim/${agent.token}`,
      claimExpiresAt: '2026-11-26T10:00:00.000Z',
      reissued,
      nextStep: `Give the claim link to your owner (${STAGING_ORIGIN})`,
    });
  }

  agentOfKey(key: string | null): Agent | null {
    if (!key) return null;
    for (const agent of this.agents.values()) if (agent.keys.has(key)) return agent;
    return null;
  }

  private me(req: Req): Res {
    const agent = this.agentOfKey(req.bearer);
    if (!agent) return refusal(401, 'UNAUTHORIZED');
    return json(200, {
      id: agent.id,
      handle: agent.handle,
      name: agent.name,
      state: agent.state,
      house: agent.house,
    });
  }

  private claim(req: Req): Res {
    const email = this.tokens.get(req.bearer ?? '');
    if (!email) return refusal(401, 'UNAUTHORIZED');
    const problem = inputProblems(social.claimInput, req.body);
    if (problem) {
      this.badBodies.push(problem);
      return refusal(400, 'BAD_REQUEST');
    }
    const { requestId, token } = req.body as { requestId: string; token: string };
    const before = this.done.get(requestId);
    const agent = [...this.agents.values()].find((one) => one.token === token);
    if (!agent) return refusal(404, 'NOT_FOUND');
    if (this.invites.get(agent.inviteId)?.email !== email)
      return refusal(403, 'FORBIDDEN', 'wrong_email');
    if (agent.state === 'claimed' && !before) return refusal(404, 'NOT_FOUND');
    agent.state = 'claimed';
    this.done.set(requestId, { kind: 'claim', sig: token, ref: agent.id });
    return json(200, { agent: { handle: agent.handle, state: 'claimed' } });
  }
}

/** The console's two saves and an agent's pins, as the API answers them (`new`, `changed` or `same`; bodies checked by the contract's own inputs). */
export class FakeStories {
  stories = new Map<string, { record: Record<string, unknown>; listed: boolean }>();
  updates = new Map<string, Record<string, unknown>>();
  /** What was saved, in order: `story <id> <state>` and `update <id>`. */
  saves: string[] = [];
  badBodies: string[] = [];
  /** Live pins by posting key. */
  pins = new Map<string, Set<string>>();

  private readonly sessions: FakeSocial;

  constructor(server: FakeServer, sessions: FakeSocial) {
    this.sessions = sessions;
    server.on('POST', '/api/v1/admin/social/stories', (req) => this.saveStory(req));
    server.on('POST', '/api/v1/admin/social/updates', (req) => this.saveUpdate(req));
    server.on('GET', '/api/v1/social/me/pins', (req) => {
      const pins = [...(this.pins.get(req.bearer ?? '') ?? [])].map((storyId) => ({
        storyId,
        live: true,
      }));
      return json(200, { pins, next: null });
    });
    server.on('POST', /^\/api\/v1\/social\/me\/pins\/([0-9a-f-]{36})\/unpin$/, (req, match) => {
      const held = this.pins.get(req.bearer ?? '');
      if (!held?.delete(match[1] ?? '')) return refusal(404, 'NOT_FOUND');
      return json(200, { pin: { storyId: match[1], live: false } });
    });
  }

  private admin(req: Req): Res | null {
    return this.sessions.tokens.get(req.bearer ?? '') === ADMIN_TEST_ACCOUNT
      ? null
      : refusal(404, 'NOT_FOUND');
  }

  private same(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  private saveStory(req: Req): Res {
    const denied = this.admin(req);
    if (denied) return denied;
    const problem = inputProblems(social.saveStoryInput, req.body);
    if (problem) {
      this.badBodies.push(problem);
      return refusal(400, 'BAD_REQUEST');
    }
    const { record, listed } = req.body as { record: Record<string, unknown>; listed: boolean };
    const id = String(record.id);
    const before = this.stories.get(id);
    if (before && before.listed !== listed) return refusal(409, 'CONFLICT', 'listing_fixed');
    if (before && String(before.record.updated_at) > String(record.updated_at))
      return refusal(409, 'CONFLICT', 'older');
    const saved = !before ? 'new' : this.same(before.record, record) ? 'same' : 'changed';
    this.stories.set(id, { record, listed });
    if (saved !== 'same') this.saves.push(`story ${id} ${String(record.state)}`);
    return json(200, { id, saved, listed });
  }

  private saveUpdate(req: Req): Res {
    const denied = this.admin(req);
    if (denied) return denied;
    const problem = inputProblems(social.saveUpdateInput, req.body);
    if (problem) {
      this.badBodies.push(problem);
      return refusal(400, 'BAD_REQUEST');
    }
    const { record } = req.body as { record: Record<string, unknown> };
    const id = String(record.id);
    const before = this.updates.get(id);
    const saved = !before ? 'new' : this.same(before, record) ? 'same' : 'changed';
    this.updates.set(id, record);
    if (saved !== 'same') this.saves.push(`update ${id}`);
    return json(200, { id, storyId: record.story_id, saved });
  }
}

/** One story's tile on the fake board. */
export type FakeTile = {
  id: string;
  title?: string;
  counts?: Record<string, number>;
  picture?: { url: string } | null;
};

/**
 * The board, the desks and the health page, as the API answers them (the board's answer on staging on 19
 * November 2026: `{stories: [{id, title, categories, picture, counts}], next}`; a desk is `{posts, next}`).
 * The board's Top is `top`'s order, its Latest `latest`'s; a test moves the counts between reads with `onTopRead`.
 */
export class FakeBoard {
  top: FakeTile[] = [];
  latest: FakeTile[] = [];
  desks = new Map<string, Array<Record<string, unknown>>>();
  /** How many stories a page of the board holds (a cursor is the offset). */
  pageSize = 100;
  topReads = 0;
  latestReads = 0;
  /** Called after each Top read starts, with how many there have been, before it answers. */
  onTopRead: ((reads: number) => void) | null = null;
  /** What the health page answers, or null for no answer at all. */
  health: { status: number; body: unknown } | null = { status: 200, body: { commit: 'abc1234' } };

  constructor(server: FakeServer) {
    server.on('GET', '/api/v1/social/board', (req) => {
      const sort = req.query.get('sort') ?? 'top';
      if (sort === 'top') {
        this.topReads++;
        this.onTopRead?.(this.topReads);
      } else {
        this.latestReads++;
      }
      const all = sort === 'top' ? this.top : this.latest;
      const from = Number(req.query.get('cursor') ?? 0);
      const page = all.slice(from, from + this.pageSize);
      return json(200, {
        stories: page.map((tile) => ({
          id: tile.id,
          title: tile.title ?? 'A story',
          categories: ['general'],
          picture: tile.picture ?? null,
          counts: {
            posts: 0,
            replies: 0,
            upvotes: 0,
            views: 0,
            uniqueViews: 0,
            pins: 0,
            ...tile.counts,
          },
        })),
        next: from + this.pageSize < all.length ? String(from + this.pageSize) : null,
      });
    });
    server.on('GET', /^\/api\/v1\/social\/stories\/([0-9a-f-]{36})\/posts$/, (req, match) =>
      json(200, {
        posts: this.desks.get(match[1] ?? '') ?? [],
        next: null,
        sort: req.query.get('sort'),
      }),
    );
    server.on('GET', '/api/health', () => {
      if (!this.health) throw new TypeError('fetch failed');
      return json(this.health.status, this.health.body);
    });
  }
}

// ---------------------------------------------------------------------------------------------
// The whole harness
// ---------------------------------------------------------------------------------------------

export type Harness = {
  home: string;
  store: Store;
  clock: ReturnType<typeof fakeClock>;
  server: FakeServer;
  social: FakeSocial;
  stories: FakeStories;
  board: FakeBoard;
  /** What was printed, in order, both streams. */
  writes: Array<{ stream: 'out' | 'err'; text: string }>;
  io: Output;
  /** Every account the cast made. */
  accounts: string[];
  ctx: Ctx;
  printed(): string;
  cleanup(): void;
};

/** A temporary store (realpath'd: macOS' temporary folder sits under a symbolic link), a fake staging, a clock and a context. */
export function harness(options: { env?: Record<string, string | undefined> } = {}): Harness {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'cast-test-')));
  chmodSync(home, 0o700);
  const store = Store.open(home);
  const clock = fakeClock();
  const server = new FakeServer();
  const social = new FakeSocial(server, () => new Date(clock.now()).toISOString());
  const stories = new FakeStories(server, social);
  const board = new FakeBoard(server);
  const writes: Harness['writes'] = [];
  const io = makeOutput((stream, text) => writes.push({ stream, text }));
  const accounts: string[] = [];
  const auth: Auth = {
    createAccount: async (email) => {
      accounts.push(email);
    },
    accessToken: async (email) => social.tokenFor(email),
  };
  const ctx: Ctx = {
    store,
    clock,
    fetch: server.fetch,
    env: options.env ?? {},
    io,
    auth: () => auth,
    stdin: async () => '',
    cwd: home,
    memo: new Map(),
  };
  return {
    home,
    store,
    clock,
    server,
    social,
    stories,
    board,
    writes,
    io,
    accounts,
    ctx,
    printed: () => writes.map((write) => write.text).join(''),
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
}

/** Makes a member as `make` leaves it (claimed, its key in the store), without any call. Answers its handle and key. */
export function seedMember(h: Harness, key: MemberKey): { handle: string; key: string } {
  const member = MEMBERS.find((one) => one.key === key);
  if (!member) throw new Error('not a member');
  const cast = readCast(h.store);
  const entry = freshEntry(member, 1);
  entry.agentId = idOf(2000 + MEMBERS.indexOf(member));
  entry.inviteId = idOf(3000 + MEMBERS.indexOf(member));
  entry.claimedAt = new Date(h.clock.now()).toISOString();
  cast.members[key] = entry;
  writeCast(h.store, cast);
  const secret = fakeKey(MEMBERS.indexOf(member) + 10);
  h.store.writeText(keyFile(entry.handle), `${secret}\n`);
  return { handle: entry.handle, key: secret };
}

/** Makes a set current, with these story ids, and (when asked) opens run `n` on it. */
export function seedSet(
  h: Harness,
  storyIds: string[],
  options: { run?: number; file?: string } = {},
): void {
  const state = readState(h.store);
  const file = options.file ?? 'set.json';
  state.current = { file, storyIds, loadedAt: new Date(h.clock.now()).toISOString() };
  if (options.run !== undefined) {
    state.runs.push({
      n: options.run,
      set: file,
      open: true,
      startedAt: new Date(h.clock.now()).toISOString(),
      endedAt: null,
    });
  }
  writeState(h.store, state);
}
