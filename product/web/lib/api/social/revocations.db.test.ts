import { randomBytes, randomUUID } from 'node:crypto';
import { redisKey } from '@hrizzup/core';
import { transaction } from '@hrizzup/db';
import { socialRedis } from '@hrizzup/social/redis';
import { createRouterClient } from '@orpc/server';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetKeyCache } from '@/lib/api/keys.ts';
import { resetSocialCache } from '@/lib/social/cache.ts';
import { socialError } from '@/lib/social/errors.ts';
import { localDatabaseOrThrow } from '@/lib/social/local-database.ts';

/**
 * The console's two revocations against a real database (docs/social/build.md, sections 5, 7.14 and 9.3;
 * R5's design note, M3b and R9): the real router, handlers and output checks over the real functions of
 * migrations/*_social.sql, with R6's real `revokeAgentKeys` writing to a recording stand-in for Redis, so
 * what `admin.test.ts`'s stand-in can only assume is proven: that the hashes the database answers are the
 * keys' own (64 lower-case hex characters, which `revokeAgentKeys` refuses to take otherwise), that they
 * land on both of a key's copies (`key:v1` and `key:v2`) as "none" with the copy's own expiry, that a
 * revoked key is found no more by the database (`keys.find`), that a claimed agent's invite is refused
 * (409 `invite_claimed`) with its key untouched, and that a repeat answers as it is with no hashes.
 *
 * Who is signed in is stood in for (one account, an admin this run made); whether it is an admin is the
 * real `admin.is_admin()` of the real `private.admins`. Every ID, handle and email is the run's own, so a
 * database that holds the last run's rows (a local one is not rebuilt between runs) changes nothing, and
 * nothing shared (a setting, another agent) is touched.
 *
 * Run it on this Mac, on the slot's database (`infra/slots/slot db start` first), beside the other
 * database tests of this folder, one file at a time:
 *
 *   SOCIAL_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:$(infra/slots/slot env | sed -n 's/^export SUPABASE_DB_PORT=//p')/postgres" \
 *     pnpm --filter @hrizzup/web exec vitest run --no-file-parallelism lib/api/social/revocations.db.test.ts
 *
 * Without `SOCIAL_DATABASE_URL` the file does not run: Quick checks have no database.
 */

const url = process.env.SOCIAL_DATABASE_URL;

// The guard is shared (`lib/social/local-database.ts`): the host pg would connect to must be this Mac's.

const held = vi.hoisted(() => ({
  pool: null as import('pg').Pool | null,
  account: null as string | null,
}));
vi.mock('@/lib/db.ts', () => ({ database: () => held.pool }));
vi.mock('@/lib/api/context.ts', () => ({
  signedIn: async () => (held.account ? { id: held.account } : null),
}));
/** Vercel's purge, stood in for: this Mac has no edge. */
const invalidate = vi.hoisted(() => vi.fn(async (_tags: string[]) => {}));
vi.mock('@vercel/functions', async (original) => ({
  ...(await original<typeof import('@vercel/functions')>()),
  invalidateByTag: (tags: string[]) => invalidate(tags),
}));

const { router } = await import('../router.ts');

const api = () =>
  createRouterClient(router, {
    context: {
      headers: new Headers(),
      resHeaders: new Headers(),
      url: 'http://localhost:3103/api/v1/admin/social/invites',
    },
  });

const noSuchCall = { code: 'NOT_FOUND', status: 404, message: 'No such call' };

let owner: pg.Pool;
let app: pg.Pool;

const bytes = () => randomBytes(32);
const letters = (n: number) =>
  Array.from(randomBytes(n), (b) => 'abcdefghijklmnopqrstuvwxyz'[b % 26]).join('');
const hex = (hash: Buffer) => hash.toString('hex');

type Tx = Parameters<Parameters<typeof transaction>[1]>[0];
const asAccount = <T>(account: string | null, work: (tx: Tx) => Promise<T>) =>
  transaction(app, work, { account });

/**
 * Redis, stood in for by what R6's `revokeAgentKeys` uses of it: a pipeline of `set`s that `exec` runs,
 * each write kept with its options, so the test reads exactly what was written, where, and for how long.
 */
type Write = { key: string; value: unknown; options: Record<string, unknown> | undefined };
const writes: Write[] = [];
const recordingRedis = {
  pipeline() {
    const queued: Write[] = [];
    const pipeline = {
      set(key: string, value: unknown, options?: Record<string, unknown>) {
        queued.push({ key, value, options });
        return pipeline;
      },
      exec: async () => {
        writes.push(...queued);
        return queued.map(() => 'OK');
      },
    };
    return pipeline;
  },
};
const PREFIX = 'dev';
/** A key's two copies' names: what a deployment from before posting keys kept, and what this code keeps. */
const copiesOf = (hash: string) => [
  redisKey(PREFIX, 'key', 'v1', hash),
  socialRedis.keyCopy.key(PREFIX, hash),
];

/** What the run seeded: each agent with the hash of its one key, and the invite it came through. */
type Seeded = { invite: string; agent: string; keyHash: Buffer };
const seeded = {
  admin: '',
  stranger: '',
  run: '',
  /** A waiting agent whose invite is revoked. */
  waiting: {} as Seeded,
  /** A waiting agent whose keys are revoked, first without retiring it and then retiring it. */
  keyed: {} as Seeded,
  /** A claimed agent: its invite can't be revoked, its keys can. */
  claimed: {} as Seeded,
  /** A waiting agent no test revokes: what the refused calls (not an admin) must leave exactly as it was. */
  untouched: {} as Seeded,
};

/** One invite, made as the admin through the database's own function, with the code hash the test chose. */
async function makeInvite(email: string, codeHash: Buffer): Promise<string> {
  const made = await asAccount(seeded.admin, async (tx) => {
    const { rows } = await tx.query(
      'select social.admin_create_invite($1, $2, $3, $4, $5, $6::bytea, $7) as answer',
      [randomUUID(), email, `Revocations db test ${seeded.run}`, false, false, codeHash, 'hz-aaaa'],
    );
    return rows[0]?.answer as { invite: { id: string } };
  });
  return made.invite.id;
}

/** An agent joins with the invite's code and a key whose hash the test knows: its invite, its ID, its key's hash. */
async function seedAgent(email: string, claimHash: Buffer): Promise<Seeded> {
  const codeHash = bytes();
  const keyHash = bytes();
  const invite = await makeInvite(email, codeHash);
  const handle = `revoke_${letters(8)}`;
  await asAccount(null, (tx) =>
    tx.query(
      'select social.register_agent($1::bytea, $2, $3, $4, null, null, null, $5::bytea, $6, $7::bytea) as answer',
      [
        codeHash,
        randomUUID(),
        handle,
        'Revocations Test Agent',
        keyHash,
        `hz_demo_${letters(4)}`,
        claimHash,
      ],
    ),
  );
  const { rows } = await owner.query<{ id: string }>(
    'select id from social.agents where handle = $1',
    [handle],
  );
  const agent = rows[0]?.id;
  if (!agent) throw new Error('The agent registered');
  return { invite, agent, keyHash };
}

/** What the database says a key is: `keys.find`, asked with nobody signed in, as the website asks it. */
const found = (keyHash: Buffer) =>
  asAccount(null, async (tx) => {
    const { rows } = await tx.query('select keys.find($1::bytea) as answer', [keyHash]);
    return (rows[0] as { answer: unknown } | undefined)?.answer ?? null;
  });

/** The agent's state in the database, whatever the console shows. */
async function stateOf(agent: string) {
  const { rows } = await owner.query<{
    retired_at: Date | null;
    retired_reason: string | null;
    live_keys: string;
  }>(
    `select a.retired_at, a.retired_reason,
            (select count(*) from keys.agent_keys k where k.agent_id = a.id and k.revoked_at is null)::text as live_keys
       from social.agents a where a.id = $1`,
    [agent],
  );
  return rows[0];
}

beforeAll(async () => {
  if (!url) return;
  localDatabaseOrThrow(url);
  owner = new pg.Pool({ connectionString: url, max: 2 });
  app = new pg.Pool({ connectionString: url, max: 4 });
  owner.on('error', () => {});
  app.on('error', () => {});
  held.pool = app;
  resetSocialCache(null);
  resetKeyCache(recordingRedis as never, PREFIX);

  const run = randomUUID().slice(0, 8);
  seeded.run = run;
  seeded.admin = randomUUID();
  seeded.stranger = randomUUID();
  const ownerAccount = randomUUID();
  const ownerEmail = `claimed-${run}@revocations.test`;
  await owner.query(
    'insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now()), ($3, $4, now()), ($5, $6, now())',
    [
      seeded.admin,
      `admin-${run}@revocations.test`,
      seeded.stranger,
      `stranger-${run}@revocations.test`,
      ownerAccount,
      ownerEmail,
    ],
  );
  await owner.query("insert into private.admins (user_id, note) values ($1, 'A test admin')", [
    seeded.admin,
  ]);
  held.account = seeded.admin;

  seeded.waiting = await seedAgent(`waiting-${run}@revocations.test`, bytes());
  seeded.keyed = await seedAgent(`keyed-${run}@revocations.test`, bytes());
  seeded.untouched = await seedAgent(`untouched-${run}@revocations.test`, bytes());
  const claimHash = bytes();
  seeded.claimed = await seedAgent(ownerEmail, claimHash);
  await asAccount(ownerAccount, (tx) =>
    tx.query('select social.claim_agent($1, $2::bytea, $3) as answer', [
      randomUUID(),
      claimHash,
      'Revocations test owner',
    ]),
  );
}, 60_000);

afterAll(async () => {
  held.account = null;
  await Promise.all([owner?.end(), app?.end()]);
  resetKeyCache(undefined, undefined);
  resetSocialCache();
});

beforeEach(() => {
  writes.length = 0;
  invalidate.mockClear();
});

describe('the database this test seeds', () => {
  it('is on this Mac: any other host stops it before a connection is made', () => {
    expect(() =>
      localDatabaseOrThrow('postgresql://postgres:postgres@127.0.0.1:55352/postgres'),
    ).not.toThrow();
    for (const elsewhere of [
      'postgresql://postgres:x@db.example.supabase.co:5432/postgres',
      'postgresql://postgres:x@aws-0-ap-south-1.pooler.supabase.com:6543/postgres',
      'postgresql://postgres:x@127.0.0.1.example.com:5432/postgres',
      'not an address',
    ]) {
      expect(() => localDatabaseOrThrow(elsewhere), elsewhere).toThrow();
    }
  });
});

describe.skipIf(!url)('revoking an invite over the real function', () => {
  const reason = 'The revocations db test revoked this invite';

  it("retires the waiting agent and revokes its key, hands the key's hash to Redis as the database made it, and the key is found no more", async () => {
    const { invite, agent, keyHash } = seeded.waiting;
    expect(await found(keyHash), 'the key works before').toMatchObject({ kind: 'post' });

    const revoked = await api().admin.social.invites.revoke({ id: invite, reason });
    expect(revoked).toMatchObject({ id: invite, revokedReason: reason });
    expect(revoked.revokedAt).toEqual(expect.any(String));

    // The agent is retired with the invite's reason, and no key of it is live.
    const state = await stateOf(agent);
    expect(state?.retired_at).not.toBeNull();
    expect(state?.retired_reason).toBe(reason);
    expect(state?.live_keys).toBe('0');
    expect(await found(keyHash), 'the key is refused after').toBeNull();

    // Redis was told, with the database's own hash: both copies, "none", for a minute, nothing else.
    // (`revokeAgentKeys` throws for a hash that isn't 64 lower-case hex, and the handler would only log it.)
    expect(writes.map(({ key, value, options }) => ({ key, value, options }))).toEqual(
      copiesOf(hex(keyHash)).map((key) => ({
        key,
        value: 'none',
        options: { ex: socialRedis.keyCopy.seconds },
      })),
    );
    // A waiting agent is on no public read: nothing at the edge.
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('answers a repeat as it is, with no hashes: Redis is asked nothing and nothing changes', async () => {
    const { invite, keyHash } = seeded.waiting;
    const again = await api().admin.social.invites.revoke({ id: invite, reason: 'Another reason' });
    // The first reason stands.
    expect(again).toMatchObject({ id: invite, revokedReason: reason });
    expect(writes).toEqual([]);
    expect(await found(keyHash)).toBeNull();
  });

  it('refuses a claimed agent’s invite as a 409 `invite_claimed`, and leaves its key working and Redis alone', async () => {
    const { invite, agent, keyHash } = seeded.claimed;
    await expect(api().admin.social.invites.revoke({ id: invite, reason })).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
      data: { reason: 'invite_claimed' },
    });
    expect((await stateOf(agent))?.retired_at).toBeNull();
    expect(await found(keyHash)).toMatchObject({ kind: 'post' });
    expect(writes).toEqual([]);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('answers an invite that is not there as 404 "No such invite"', async () => {
    await expect(
      api().admin.social.invites.revoke({ id: randomUUID(), reason }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404, message: 'No such invite' });
    expect(writes).toEqual([]);
  });
});

describe.skipIf(!url)("revoking an agent's keys over the real function", () => {
  const reason = 'The revocations db test revoked these keys';

  it("revokes the key without retiring the agent, hands Redis the database's hash, and the key is found no more", async () => {
    const { agent, keyHash } = seeded.keyed;
    expect(await found(keyHash), 'the key works before').toMatchObject({ kind: 'post' });

    const revoked = await api().admin.social.agents.revokeKeys({ id: agent, reason });
    expect(revoked).toMatchObject({ id: agent, retired: false, keys: [] });
    expect(await found(keyHash), 'the key is refused after').toBeNull();
    const state = await stateOf(agent);
    expect(state?.retired_at).toBeNull();
    expect(state?.live_keys).toBe('0');

    expect(writes.map(({ key, value, options }) => ({ key, value, options }))).toEqual(
      copiesOf(hex(keyHash)).map((key) => ({
        key,
        value: 'none',
        options: { ex: socialRedis.keyCopy.seconds },
      })),
    );
    // Keys alone change nothing a reader sees: no edge copy is cleared.
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('answers a repeat as it is, with no hashes, and asks Redis for nothing', async () => {
    const { agent } = seeded.keyed;
    await expect(
      api().admin.social.agents.revokeKeys({ id: agent, reason }),
    ).resolves.toMatchObject({ id: agent, retired: false, keys: [] });
    expect(writes).toEqual([]);
  });

  it("retires it when asked, with the reason, and clears the agent's edge copies and the directory's", async () => {
    const { agent } = seeded.keyed;
    const retired = await api().admin.social.agents.revokeKeys({ id: agent, reason, retire: true });
    expect(retired).toMatchObject({
      id: agent,
      retired: true,
      state: 'retired',
      retiredReason: reason,
      keys: [],
    });
    expect((await stateOf(agent))?.retired_reason).toBe(reason);
    expect(writes, 'there was no key left to forget').toEqual([]);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith([`social:agent:${agent}`, 'social:agents']);
  });

  it("revokes a claimed agent's key and retires it in one call: the hash goes to Redis and the key is found no more", async () => {
    const { agent, keyHash } = seeded.claimed;
    const retired = await api().admin.social.agents.revokeKeys({
      id: agent.toUpperCase(),
      reason,
      retire: true,
    });
    expect(retired).toMatchObject({ id: agent, claimed: true, retired: true, keys: [] });
    expect(await found(keyHash)).toBeNull();
    expect(writes.map(({ key }) => key)).toEqual(copiesOf(hex(keyHash)));
    expect(invalidate).toHaveBeenCalledWith([`social:agent:${agent}`, 'social:agents']);
  });

  it('answers an agent that is not there as 404 "No such agent"', async () => {
    await expect(
      api().admin.social.agents.revokeKeys({ id: randomUUID(), reason, retire: true }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404, message: 'No such agent' });
    expect(writes).toEqual([]);
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe.skipIf(!url)('who may revoke, over the real admins table', () => {
  it('is an admin only: nobody signed in, and an account that is no admin, are told "No such call", and nothing is revoked', async () => {
    // An agent no other test touches, still waiting, with a live key: if either call got through it
    // would be retired, its key revoked and its invite closed.
    const { invite, agent, keyHash } = seeded.untouched;
    for (const account of [null, seeded.stranger]) {
      held.account = account;
      await expect(
        api().admin.social.invites.revoke({ id: invite, reason: 'x' }),
      ).rejects.toMatchObject(noSuchCall);
      await expect(
        api().admin.social.agents.revokeKeys({ id: agent, reason: 'x', retire: true }),
      ).rejects.toMatchObject(noSuchCall);
    }
    held.account = seeded.admin;
    expect(await found(keyHash), 'its key still works').toMatchObject({ kind: 'post' });
    expect((await stateOf(agent))?.retired_at).toBeNull();
    const { rows } = await owner.query<{ revoked_at: Date | null }>(
      'select revoked_at from social.invites where id = $1',
      [invite],
    );
    expect(rows[0]?.revoked_at, 'its invite is still open').toBeNull();
    expect(writes).toEqual([]);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('is refused by the database itself too, as the same "No such call", for both functions', async () => {
    const statements: [string, unknown[]][] = [
      ['select social.admin_revoke_invite($1, $2) as answer', [seeded.waiting.invite, 'x']],
      [
        'select social.admin_revoke_agent_keys($1, $2, $3) as answer',
        [seeded.claimed.agent, 'x', true],
      ],
    ];
    for (const account of [null, seeded.stranger]) {
      for (const [sql, values] of statements) {
        const error = await asAccount(account, (tx) => tx.query(sql, values)).then(
          () => null,
          (caught: unknown) => caught,
        );
        expect(socialError(error, 'admin'), sql).toMatchObject(noSuchCall);
      }
    }
  });
});
