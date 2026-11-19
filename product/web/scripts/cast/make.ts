import { STAGING_ORIGIN } from '../../lib/auth-relay.ts';
import { adminCall, adminPages, adminRaw } from './admin.ts';
import type { Ctx } from './context.ts';
import { type CastError, refuse } from './errors.ts';
import { readyMessageParts } from './guard.ts';
import { type Answer, reasonOf, refusedBy, send, sendRaw } from './http.ts';
import { MAX_ATTEMPT } from './ids.ts';
import { object, text } from './lenient.ts';
import {
  bioOf,
  codeFile,
  type Entry,
  findMember,
  freshEntry,
  inviteNoteOf,
  keyFile,
  MEMBERS,
  type Member,
  OWNER_NAME,
  readCast,
  writeCast,
} from './members.ts';
import { learn } from './redact.ts';

/**
 * `make` and `retire` (rules 11 and 12): each member is made, or resumed from what the store holds,
 * so a command that stopped anywhere is simply run again. Every request's ID comes from what it
 * sends (`requestIdFor`): the member's email and *n* take the places of a handle and a run, so the
 * invite, the registration and the claim each reach the same thing when sent again.
 *
 * Order of writes, which is what makes a crash safe: the invite's code is written to `codes/`
 * before the invite is noted in `cast.json`; the posting key is written to `keys/` before anything
 * else uses the registration's answer; the code is deleted only after the agent is seen claimed.
 */

const say = (ctx: Ctx, member: Member, step: string) => ctx.io.out(`${member.key}: ${step}`);

/** The skill file must send an agent to staging's API; its parts' revisions are noted for the record. */
async function checkSkill(ctx: Ctx): Promise<void> {
  if (ctx.memo.get('skill-checked')) return;
  const answer = await send(ctx, { method: 'GET', path: '/skill.md', root: true });
  if (!answer.text.includes(`${STAGING_ORIGIN}/api/v1/social/agents`)) {
    throw refuse(
      `The live skill file does not name ${STAGING_ORIGIN}/api/v1/social/agents: refused`,
    );
  }
  const revisions = [...answer.text.matchAll(/<!-- part (\w+), revision (\d+),/g)]
    .map((found) => `${found[1]} ${found[2]}`)
    .join(', ');
  ctx.io.out(`skill.md read from ${STAGING_ORIGIN}: ${revisions || 'no revisions listed'}`);
  ctx.memo.set('skill-checked', true);
}

/** Revokes every open invite of an email (the open one that stands in the way of a new one). */
async function revokeOpenInvites(ctx: Ctx, email: string): Promise<void> {
  const isOpen = (invite: Record<string, unknown>) =>
    text(invite.email) === email && invite.usedAt === null && invite.revokedAt === null;
  // The list is newest first: stop at the page that has the open one.
  const invites = await adminPages(ctx, '/admin/social/invites', 'invites', (items) =>
    items.some(isOpen),
  );
  const open = invites.filter(isOpen);
  if (open.length === 0) {
    throw refuse(`${email} has an open invite the invites list does not show: look in the console`);
  }
  for (const invite of open) {
    await adminCall(ctx, 'POST', `/admin/social/invites/${text(invite.id)}/revoke`, {
      body: { reason: 'Test cast: replaced by a new invite' },
    });
  }
}

/** Steps 2 and 3: the invite, then its code in `codes/` and its id in `cast.json`. */
async function makeInvite(ctx: Ctx, member: Member, entry: Entry, save: () => void): Promise<void> {
  const path = '/admin/social/invites';
  for (let attempt = 1; attempt <= MAX_ATTEMPT; attempt++) {
    const body = {
      email: entry.email,
      note: inviteNoteOf(member),
      house: true,
      listed: true,
    };
    const id = { subject: entry.email, run: entry.n, attempt };
    let answer: Answer = await adminRaw(ctx, 'POST', path, { body, id });
    if (answer.status === 409 && reasonOf(answer.body) === 'invite_open') {
      await revokeOpenInvites(ctx, entry.email);
      answer = await adminRaw(ctx, 'POST', path, { body, id });
    }
    const reason = reasonOf(answer.body);
    // A replay that is dead (the invite was used, or revoked or expired since): the next attempt is a new request.
    if (answer.status === 409 && (reason === 'invite_used' || reason === 'invite_revoked'))
      continue;
    if (!answer.ok) throw refusedBy({ method: 'POST', path }, answer);

    const code = text(answer.body.code);
    // The invite's code is a secret from here on, wherever it would be printed (a refusal's own `code` is not).
    learn(code);
    const message = text(answer.body.message);
    const ready = message ? readyMessageParts(message) : null;
    if (!code || !ready || ready.origin !== STAGING_ORIGIN || ready.code !== code) {
      throw refuse(
        `${member.key}: the invite's ready message does not name ${STAGING_ORIGIN}: refused`,
      );
    }
    ctx.store.writeText(codeFile(entry.handle), `${code}\n`);
    entry.inviteId = text(object(answer.body.invite).id);
    entry.retiredAt = null;
    save();
    say(ctx, member, 'invite made');
    return;
  }
  throw refuse(
    `${member.key}: its invite requests were all used or revoked: run \`retire ${member.key}\`, then \`make\``,
  );
}

/** Joining refused in a way only a new generation of the member can mend (the design's edge cases). */
function registrationRefusal(member: Member, answer: Answer): CastError | null {
  const reason = reasonOf(answer.body);
  if (
    answer.status === 409 &&
    (reason === 'invite_used' || reason === 'handle_taken' || reason === 'already_claimed')
  ) {
    return refuse(
      `${member.key}: joining was refused (${reason}): run \`retire ${member.key}\`, then \`make\``,
    );
  }
  return null;
}

/**
 * Steps 5 and 7: join with the invite's code. The key is written first. Answers the claim link,
 * which is kept in memory only, or `dead-invite` when the invite has expired or been revoked.
 */
async function register(
  ctx: Ctx,
  member: Member,
  entry: Entry,
  save: () => void,
): Promise<string | 'dead-invite'> {
  const code = ctx.store.readText(codeFile(entry.handle))?.trim();
  if (!code) {
    throw refuse(
      `${member.key}: no invite code is saved: run \`retire ${member.key}\`, then \`make\``,
    );
  }
  learn(code);
  const path = '/social/agents';
  const answer = await sendRaw(ctx, {
    method: 'POST',
    path,
    body: { inviteCode: code, handle: entry.handle, name: member.name, bio: bioOf(member) },
    id: { subject: entry.email, run: entry.n, attempt: 1 },
  });
  if (!answer.ok) {
    const refusal = registrationRefusal(member, answer);
    if (refusal) throw refusal;
    const reason = reasonOf(answer.body);
    if (answer.status === 401 || reason === 'invite_expired' || reason === 'invite_revoked') {
      return 'dead-invite';
    }
    throw refusedBy({ method: 'POST', path }, answer);
  }
  const secret = text(answer.body.secret);
  const claimUrl = text(answer.body.claimUrl);
  if (!secret || !claimUrl) {
    throw refuse(`${member.key}: the registration's answer is missing its key or link`);
  }
  ctx.store.writeText(keyFile(entry.handle), `${secret}\n`);
  entry.agentId = text(object(answer.body.agent).id) ?? entry.agentId;
  save();
  say(ctx, member, 'joined');
  return claimUrl;
}

/** Step 8: the owner claims the agent, signed in as the account (the session's token), with the link's token. */
async function claim(ctx: Ctx, member: Member, entry: Entry, claimUrl: string): Promise<Answer> {
  let url: URL;
  try {
    url = new URL(claimUrl);
  } catch {
    throw refuse(`${member.key}: the claim link is not an address`);
  }
  const token = url.pathname.split('/').at(-1) ?? '';
  if (url.origin !== STAGING_ORIGIN || !/^[A-Za-z0-9]{43}$/.test(token)) {
    throw refuse(`${member.key}: the claim link is not staging's: refused`);
  }
  learn(token);
  return sendRaw(ctx, {
    method: 'POST',
    path: '/owner/claims',
    bearer: await ctx.auth().accessToken(entry.email),
    body: { token, ownerName: OWNER_NAME },
    id: { subject: entry.email, run: entry.n, attempt: 1 },
  });
}

/** Step 6 and 9: where the agent stands, from its own key. */
async function whereItStands(ctx: Ctx, entry: Entry): Promise<Answer> {
  const key = ctx.store.readText(keyFile(entry.handle))?.trim() ?? '';
  return sendRaw(ctx, { method: 'GET', path: '/social/me', key });
}

export async function makeMember(ctx: Ctx, member: Member): Promise<void> {
  const cast = readCast(ctx.store);
  const entry = cast.members[member.key] ?? freshEntry(member, 1);
  const save = () => {
    cast.members[member.key] = entry;
    writeCast(ctx.store, cast);
  };
  const retireAdvice = `run \`retire ${member.key}\`, then \`make\``;

  // 1. The account (an existing one counts as done).
  await ctx.auth().createAccount(entry.email);
  say(ctx, member, 'account ready');

  let claimed = entry.claimedAt !== null && ctx.store.exists(keyFile(entry.handle));
  // A dead invite (expired or revoked before the claim) is replaced once; a second one needs a new generation.
  for (let invites = 0; !claimed; invites++) {
    if (invites > 1) throw refuse(`${member.key}: its invite kept expiring: ${retireAdvice}`);
    const haveKey = ctx.store.exists(keyFile(entry.handle));
    let claimUrl: string;

    if (haveKey) {
      // The agent exists. Where does it stand? (Step 6.)
      const seen = await whereItStands(ctx, entry);
      if (seen.ok) {
        entry.agentId = text(seen.body.id) ?? entry.agentId;
        if (seen.body.state === 'claimed') break;
      } else if (seen.status !== 401) {
        throw refusedBy({ method: 'GET', path: '/social/me' }, seen);
      }
      // Waiting, or its key no longer works. With no claim link in memory, join again with the
      // same ID and code (a reissue: a new key and link, written over `keys/`). (Step 7.)
      if (!ctx.store.exists(codeFile(entry.handle))) {
        throw refuse(`${member.key}: it has no code to join again with: ${retireAdvice}`);
      }
      await checkSkill(ctx);
      const again = await register(ctx, member, entry, save);
      if (again === 'dead-invite')
        throw refuse(`${member.key}: its invite expired before it was claimed: ${retireAdvice}`);
      claimUrl = again;
    } else {
      // Steps 2 to 5.
      if (entry.inviteId === null || !ctx.store.exists(codeFile(entry.handle))) {
        await makeInvite(ctx, member, entry, save);
      }
      await checkSkill(ctx);
      const first = await register(ctx, member, entry, save);
      if (first === 'dead-invite') {
        ctx.store.remove(codeFile(entry.handle));
        entry.inviteId = null;
        save();
        continue;
      }
      claimUrl = first;
    }

    // Step 8: the owner claims. A link that has gone (404) is replaced once, by joining again.
    let answer = await claim(ctx, member, entry, claimUrl);
    if (answer.status === 404) {
      const reissued = await register(ctx, member, entry, save);
      if (reissued === 'dead-invite')
        throw refuse(`${member.key}: its invite expired before it was claimed: ${retireAdvice}`);
      answer = await claim(ctx, member, entry, reissued);
    }
    if (!answer.ok) throw refusedBy({ method: 'POST', path: '/owner/claims' }, answer);
    say(ctx, member, 'claimed');
    claimed = true;
  }

  // 9. It must be claimed and Hrizzup's own (the invite's `house`); only then is the code deleted.
  const seen = await whereItStands(ctx, entry);
  if (!seen.ok) throw refusedBy({ method: 'GET', path: '/social/me' }, seen);
  if (seen.body.state !== 'claimed' || seen.body.house !== true) {
    throw refuse(`${member.key}: it is not claimed and Hrizzup's own after the claim: refused`);
  }
  entry.agentId = text(seen.body.id) ?? entry.agentId;
  entry.claimedAt ??= new Date(ctx.clock.now()).toISOString();
  ctx.store.remove(codeFile(entry.handle));
  save();
  say(ctx, member, 'ready');
}

/** `make`: makes or resumes each member, in order. */
export async function makeCommand(ctx: Ctx): Promise<void> {
  ctx.auth();
  for (const member of MEMBERS) await makeMember(ctx, member);
}

/** The agent's id, found by its handle in the admin's list of agents. */
async function findAgentId(ctx: Ctx, handle: string): Promise<string | null> {
  const agents = await adminPages(ctx, '/admin/social/agents', 'agents');
  const found = agents.find((agent) => text(agent.handle) === handle);
  return found ? text(found.id) : null;
}

/**
 * `retire [member]`: revokes what the member holds (an agent: its keys, retiring it; only an
 * invite: the invite, which retires its waiting agent; neither: nothing), deletes the member's
 * files, and moves it on to its next *n*, ready for `make`.
 */
export async function retireCommand(ctx: Ctx, name?: string): Promise<void> {
  ctx.auth();
  const only = name === undefined ? undefined : findMember(name);
  if (name !== undefined && !only) throw refuse(`${name} is not a member of the cast`);
  for (const member of only ? [only] : MEMBERS) {
    const cast = readCast(ctx.store);
    const entry = cast.members[member.key] ?? freshEntry(member, 1);
    if (entry.retiredAt !== null && entry.inviteId === null && entry.agentId === null) {
      say(ctx, member, `already retired; \`make\` makes ${entry.handle}`);
      continue;
    }
    const reason = 'Test cast: retired';
    let agentId = entry.agentId;
    if (agentId === null && entry.inviteId !== null) {
      const answer = await adminRaw(ctx, 'POST', `/admin/social/invites/${entry.inviteId}/revoke`, {
        body: { reason },
      });
      if (answer.status === 409 && reasonOf(answer.body) === 'invite_claimed') {
        agentId = await findAgentId(ctx, entry.handle);
        if (!agentId)
          throw refuse(
            `${member.key}: its invite was claimed but its agent is not in the console's list`,
          );
      } else if (!answer.ok) {
        throw refusedBy({ method: 'POST', path: '/admin/social/invites/{uuid}/revoke' }, answer);
      } else {
        say(ctx, member, 'invite revoked');
      }
    }
    if (agentId !== null) {
      await adminCall(ctx, 'POST', `/admin/social/agents/${agentId}/revoke-keys`, {
        body: { reason, retire: true },
      });
      say(ctx, member, 'agent retired, its keys revoked');
    }
    ctx.store.remove(keyFile(entry.handle));
    ctx.store.remove(codeFile(entry.handle));
    const next = freshEntry(member, entry.n + 1);
    next.retiredAt = new Date(ctx.clock.now()).toISOString();
    cast.members[member.key] = next;
    writeCast(ctx.store, cast);
    say(ctx, member, `retired; \`make\` makes ${next.handle}`);
  }
}
