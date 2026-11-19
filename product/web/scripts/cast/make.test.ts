import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_TEST_ACCOUNT } from '../../e2e/support/test-accounts.ts';
import { STAGING_ORIGIN } from '../../lib/auth-relay.ts';
import { fakeCode, type Harness, harness, json } from './harness.ts';
import { requestIdFor } from './ids.ts';
import { main } from './main.ts';
import { makeCommand, makeMember } from './make.ts';
import { codeFile, emailOf, keyFile, MEMBERS, readCast } from './members.ts';

/** Test group 9: `make`. A stop at any step, then a run again, leaves one invite and one agent. */

/** Starting Node, and making six members a stop at a time, take a little: give them room on a slow machine. */
vi.setConfig({ testTimeout: 60_000 });

let h: Harness;
beforeEach(() => {
  h = harness();
});
afterEach(() => h.cleanup());

const explainer = MEMBERS[0];

class Crash extends Error {}

describe('make', () => {
  it('makes each member: an account, a house and listed invite, a joined agent with its key saved, claimed by its owner', async () => {
    await makeCommand(h.ctx);
    expect(h.accounts).toEqual(MEMBERS.map((member) => emailOf(member, 1)));
    expect(h.social.invites.size).toBe(6);
    expect(h.social.agents.size).toBe(6);
    expect(h.social.badBodies).toEqual([]);
    const cast = readCast(h.store);
    for (const member of MEMBERS) {
      const entry = cast.members[member.key];
      const invite = [...h.social.invites.values()].find((one) => one.email === emailOf(member, 1));
      const agent = [...h.social.agents.values()].find((one) => one.handle === member.handle);
      expect(invite).toMatchObject({
        house: true,
        listed: true,
        note: `Test cast: ${member.name}`,
      });
      expect(agent?.state).toBe('claimed');
      expect(agent?.house).toBe(true);
      expect(agent?.bio).toContain('A Hrizzup test agent on staging.');
      expect(entry).toMatchObject({
        n: 1,
        handle: member.handle,
        agentId: agent?.id,
        inviteId: invite?.id,
        retiredAt: null,
      });
      expect(entry?.claimedAt).not.toBeNull();
      // The key is in the store, the one live key; the code is gone.
      expect([...(agent?.keys ?? [])]).toEqual([h.store.readText(keyFile(member.handle))?.trim()]);
      expect(h.store.exists(codeFile(member.handle))).toBe(false);
    }
  });

  it('sends the invite and the claim as the right accounts, and the registration and the skill file as anyone', async () => {
    await makeMember(h.ctx, explainer);
    const invite = h.server.to('POST', /admin\/social\/invites$/)[0];
    expect(h.social.tokens.get(invite?.bearer ?? '')).toBe(ADMIN_TEST_ACCOUNT);
    const skill = h.server.to('GET', /^\/skill\.md$/)[0];
    expect(skill?.headers.authorization).toBeUndefined();
    const join = h.server.to('POST', /\/social\/agents$/)[0];
    expect(join?.headers.authorization).toBeUndefined();
    expect(join?.body).toMatchObject({ handle: 'hztest_explainer', name: 'Explainer' });
    const claim = h.server.to('POST', /owner\/claims$/)[0];
    expect(h.social.tokens.get(claim?.bearer ?? '')).toBe(emailOf(explainer, 1));
    expect(claim?.body?.ownerName).toBe('Hrizzup test cast');
    for (const req of h.server.requests) expect(req.url.startsWith(STAGING_ORIGIN)).toBe(true);
    expect(h.printed()).toContain('skill.md read from');
    expect(h.printed()).toContain('basics 2, agents 3');
  });

  it('saves the key before the claim, and deletes the code only after it', async () => {
    const seen: Array<{ key: boolean; code: boolean }> = [];
    h.server.onRequest = (req) => {
      if (/owner\/claims$/.test(req.path)) {
        seen.push({
          key: h.store.exists(keyFile('hztest_explainer')),
          code: h.store.exists(codeFile('hztest_explainer')),
        });
      }
    };
    await makeMember(h.ctx, explainer);
    expect(seen).toEqual([{ key: true, code: true }]);
    expect(h.store.exists(codeFile('hztest_explainer'))).toBe(false);
  });

  it('run again does nothing more than look: no new invite, agent or key', async () => {
    await makeCommand(h.ctx);
    const keys = MEMBERS.map((member) => h.store.readText(keyFile(member.handle)));
    h.server.requests.length = 0;
    await makeCommand(h.ctx);
    expect(h.social.invites.size).toBe(6);
    expect(h.social.agents.size).toBe(6);
    expect(h.server.to('POST', /.*/)).toEqual([]);
    expect(MEMBERS.map((member) => h.store.readText(keyFile(member.handle)))).toEqual(keys);
  });

  it('refuses a ready message that names another origin, and keeps no code', async () => {
    h.server.on('POST', '/api/v1/admin/social/invites', () =>
      json(201, {
        invite: { id: '01900000-0000-7000-8000-0000000000aa', email: emailOf(explainer, 1) },
        code: fakeCode(1),
        message: `You're invited to Hrizzup's agent beta. Give your agent this one line: Read https://hrizzup-abc123-hrizzup.vercel.app/skill.md and join Hrizzup with invite code ${fakeCode(1)}. It will give you a claim link: open it and sign in with ${emailOf(explainer, 1)}.`,
      }),
    );
    expect(await main(['make'], h.io, () => h.ctx)).toBe(2);
    expect(h.printed()).toContain('does not name');
    expect(h.store.exists(codeFile('hztest_explainer'))).toBe(false);
    expect(h.server.to('POST', /social\/agents$/)).toEqual([]);
  });

  it('refuses a skill file that does not send agents to staging', async () => {
    h.server.on('GET', '/skill.md', () => ({
      status: 200,
      text: '# a guide\ncurl https://example.com/api/v1/social/agents\n',
    }));
    expect(await main(['make'], h.io, () => h.ctx)).toBe(2);
    expect(h.server.to('POST', /social\/agents$/)).toEqual([]);
    expect(h.store.exists(keyFile('hztest_explainer'))).toBe(false);
  });

  it("revokes the email's open invite and makes a new one, once, on 409 invite_open", async () => {
    // Someone made an invite for this email through the console, with another request.
    h.social.invites.set('01900000-0000-7000-8000-0000000000bb', {
      id: '01900000-0000-7000-8000-0000000000bb',
      email: emailOf(explainer, 1),
      note: null,
      house: false,
      listed: false,
      code: fakeCode(9),
      usedAt: null,
      revokedAt: null,
      agentId: null,
    });
    await makeMember(h.ctx, explainer);
    const open = [...h.social.invites.values()].filter(
      (one) => one.email === emailOf(explainer, 1),
    );
    expect(open).toHaveLength(2);
    expect(open.filter((one) => one.revokedAt)).toHaveLength(1);
    expect(h.server.to('POST', /invites\/[0-9a-f-]{36}\/revoke$/)).toHaveLength(1);
    expect(h.social.agents.size).toBe(1);
    expect(h.social.badBodies).toEqual([]);
  });

  it('stops paging the invites list at the page that holds the open invite', async () => {
    const open = {
      id: '01900000-0000-7000-8000-0000000000dd',
      email: emailOf(explainer, 1),
      usedAt: null,
      revokedAt: null,
    };
    h.social.invites.set(open.id, {
      ...open,
      note: null,
      house: false,
      listed: false,
      code: fakeCode(9),
      agentId: null,
    });
    let pages = 0;
    h.server.on('GET', '/api/v1/admin/social/invites', () => {
      pages++;
      return json(200, { invites: [open], next: 'more-pages-follow' });
    });
    await makeMember(h.ctx, explainer);
    expect(pages).toBe(1);
    expect(h.server.to('POST', /invites\/[0-9a-f-]{36}\/revoke$/)).toHaveLength(1);
  });

  it('asks the user to retire the member when its handle is taken, or its invite was used with no key saved', async () => {
    h.social.agents.set('01900000-0000-7000-8000-0000000000cc', {
      id: '01900000-0000-7000-8000-0000000000cc',
      handle: 'hztest_explainer',
      name: 'Someone',
      bio: null,
      state: 'claimed',
      house: false,
      inviteId: 'x',
      keys: new Set(),
      token: '',
    });
    expect(await main(['make'], h.io, () => h.ctx)).toBe(2);
    expect(h.printed()).toContain('run `retire explainer`, then `make`');
    expect(h.store.exists(keyFile('hztest_explainer'))).toBe(false);
  });

  it('exits 4 at the registration limit, and can be run again later', async () => {
    h.server.on('POST', '/api/v1/social/agents', () => ({
      status: 429,
      body: { code: 'TOO_MANY_REQUESTS', data: { retryAfterSeconds: 2400 } },
      headers: { 'retry-after': '2400' },
    }));
    expect(await main(['make'], h.io, () => h.ctx)).toBe(4);
    expect(h.printed()).toContain('wait 2400 seconds');
  });

  it('makes the next invite as attempt 2, not attempt 1 again, when the one it made expired before the agent joined', async () => {
    // The invite dies between its making and the join (the first registration finds it revoked).
    let killed = false;
    h.server.onRequest = (req) => {
      if (!killed && /social\/agents$/.test(req.path) && req.method === 'POST') {
        killed = true;
        for (const invite of h.social.invites.values()) invite.revokedAt = 'expired';
      }
    };
    await makeMember(h.ctx, explainer);
    expect(killed).toBe(true);
    const asked = h.server.to('POST', /admin\/social\/invites$/);
    // Exactly two requests: attempt 1, then attempt 2 (no replay of attempt 1, which could only be refused).
    expect(asked).toHaveLength(2);
    const body = {
      email: emailOf(explainer, 1),
      note: 'Test cast: Explainer',
      house: true,
      listed: true,
    };
    const idOf = (attempt: number) =>
      requestIdFor({
        subject: emailOf(explainer, 1),
        run: 1,
        method: 'POST',
        path: '/admin/social/invites',
        body,
        attempt,
      });
    expect(asked.map((req) => req.body?.requestId)).toEqual([idOf(1), idOf(2)]);
    expect(h.server.to('POST', /invites\/[0-9a-f-]{36}\/revoke$/)).toEqual([]);
    expect([...h.social.invites.values()].filter((one) => !one.revokedAt)).toHaveLength(1);
    expect(h.social.agents.size).toBe(1);
    expect([...h.social.agents.values()][0]?.state).toBe('claimed');
    expect(h.social.badBodies).toEqual([]);
  });

  it('makes a new invite when the one it holds was revoked before the agent joined', async () => {
    h.server.fault = { at: 2, apply: false };
    // Stop after the invite is made (the invite is request 0, the skill file 1): the join never lands.
    await expect(makeMember(h.ctx, explainer)).rejects.toMatchObject({ exit: 3 });
    h.server.fault = null;
    for (const invite of h.social.invites.values()) invite.revokedAt = 'now';
    await makeMember(h.ctx, explainer);
    expect([...h.social.agents.values()]).toHaveLength(1);
    expect([...h.social.invites.values()].filter((one) => !one.revokedAt)).toHaveLength(1);
    expect(readCast(h.store).members.explainer?.claimedAt).not.toBeNull();
    expect(h.social.badBodies).toEqual([]);
  });
});

/** The end state every stop must lead to, once `make` is run again. */
function expectOneInviteOneAgent(): void {
  const invites = [...h.social.invites.values()].filter(
    (one) => one.email === emailOf(explainer, 1),
  );
  expect(invites).toHaveLength(1);
  expect(h.social.agents.size).toBe(1);
  const agent = [...h.social.agents.values()][0];
  expect(agent?.state).toBe('claimed');
  expect(agent?.keys.size).toBe(1);
  expect([...(agent?.keys ?? [])]).toEqual([h.store.readText(keyFile('hztest_explainer'))?.trim()]);
  expect(h.store.exists(codeFile('hztest_explainer'))).toBe(false);
  const entry = readCast(h.store).members.explainer;
  expect(entry?.agentId).toBe(agent?.id);
  expect(entry?.inviteId).toBe(invites[0]?.id);
  expect(entry?.claimedAt).not.toBeNull();
}

describe('a stop at any step', () => {
  /** How many requests one uninterrupted `make` of the explainer sends. */
  async function requestsInAFullRun(): Promise<number> {
    const clean = harness();
    try {
      await makeMember(clean.ctx, explainer);
      return clean.server.requests.length;
    } finally {
      clean.cleanup();
    }
  }

  it.each([
    ['before the request lands', false],
    ['after the server did it and the answer was lost', true],
  ])('at each request, %s, then a rerun leaves one invite and one agent', async (_when, apply) => {
    const total = await requestsInAFullRun();
    expect(total).toBe(5);
    for (let at = 0; at < total; at++) {
      const run = harness();
      try {
        h.cleanup();
        h = run;
        run.server.fault = { at, apply };
        await expect(
          makeMember(run.ctx, explainer),
          `a stop at request ${at}`,
        ).rejects.toMatchObject({ exit: 3 });
        run.server.fault = null;
        run.ctx.memo.clear(); // a new process remembers nothing
        await makeMember(run.ctx, explainer);
        expectOneInviteOneAgent();
        expect(run.social.badBodies).toEqual([]);
        // And a third run only looks.
        run.server.requests.length = 0;
        run.ctx.memo.clear();
        await makeMember(run.ctx, explainer);
        expect(run.server.to('POST', /.*/)).toEqual([]);
        expectOneInviteOneAgent();
      } finally {
        run.cleanup();
      }
    }
  });

  it('at each write to the store, then a rerun leaves one invite and one agent', async () => {
    // Count the writes of a full run first (the pacing file's are left out).
    let writes = 0;
    const clean = harness();
    try {
      clean.store.hooks.beforeRename = (path) => {
        if (!path.endsWith('pace.json')) writes++;
      };
      await makeMember(clean.ctx, explainer);
    } finally {
      clean.cleanup();
    }
    expect(writes).toBeGreaterThanOrEqual(5);
    for (let stop = 1; stop <= writes; stop++) {
      const run = harness();
      try {
        h.cleanup();
        h = run;
        let seen = 0;
        run.store.hooks.beforeRename = (path) => {
          if (!path.endsWith('pace.json') && ++seen === stop) throw new Crash('the power went');
        };
        await expect(
          makeMember(run.ctx, explainer),
          `a stop at write ${stop}`,
        ).rejects.toBeInstanceOf(Crash);
        run.store.hooks.beforeRename = undefined;
        run.ctx.memo.clear();
        await makeMember(run.ctx, explainer);
        expectOneInviteOneAgent();
      } finally {
        run.cleanup();
      }
    }
  });
});
