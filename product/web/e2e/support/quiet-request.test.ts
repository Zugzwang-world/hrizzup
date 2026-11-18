import { social as examples } from '@hrizzup/api/examples';
import type { APIRequestContext } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import { runAgent } from '../../../../examples/agent/agent.ts';
import { type NotedAgent, noteRegistration, revokeAgentKeys } from './agent-clean-up.ts';
import { call, callWith, fetchThrough, noAnswer, quietly } from './quiet-request.ts';

/**
 * Quick checks of the requests the agents' journeys make (support/quiet-request.ts, support/agent-clean-up.ts;
 * Round 6, R6): a request that throws is thrown again naming only its method and path, because Playwright's
 * call log, which every thrown request carries in its message, holds every header the request sent (a posting
 * key's `Authorization`, a session's cookies) and the reporters print it into a check's public log. The
 * stand-ins below throw a message made like Playwright's, with made-up values.
 */

const KEY = 'hz_demo_made_up_for_the_quick_check';
const COOKIE = 'sb-made-up-session-cookie';

/** What Playwright throws for a request that fails: the call log, with every header it sent. */
const callLogOf = (method: string, url: string) =>
  new Error(
    `apiRequestContext.fetch: socket hang up\nCall log:\n  - → ${method} ${url}\n  - authorization: Bearer ${KEY}\n  - cookie: ${COOKIE}`,
  );

/** A request context that answers from a list, one for each call; an `Error` in it is thrown. */
function context(answers: (Error | { status: number; text: string })[]) {
  const sent: { url: string; method?: string; data?: unknown }[] = [];
  let at = 0;
  const stand = {
    fetch: async (url: string, options: { method?: string; data?: unknown }) => {
      sent.push({ url, ...options });
      const answer = answers[at++] ?? answers.at(-1);
      if (answer instanceof Error) throw answer;
      return {
        status: () => answer?.status ?? 200,
        text: async () => answer?.text ?? '',
        headers: () => ({}) as Record<string, string>,
      };
    },
  };
  return { as: stand as unknown as APIRequestContext, sent };
}

/** Whether a failure says anything of the secrets: a boolean only, so a failure here prints nothing of them. */
const tellsSecrets = (error: unknown): boolean => {
  const text = `${(error as Error).message}\n${(error as Error).stack}\n${String((error as Error).cause)}`;
  return text.includes(KEY) || text.includes(COOKIE) || text.includes('authorization');
};

describe('a request that throws', () => {
  it('becomes a TypeError naming the method and the path, never the address, a header or the cause', () => {
    const error = noAnswer('POST', 'https://x.test/api/v1/social/me/posts?token=made-up');
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toBe('POST /api/v1/social/me/posts got no answer');
    expect(error.cause).toBeUndefined();
  });

  it("leaves what a request answers alone, and hides Playwright's call log when it throws", async () => {
    expect(await quietly('GET', '/api/v1/x', async () => 7)).toBe(7);
    const failure = await quietly('POST', '/api/v1/x', async () => {
      throw callLogOf('POST', 'https://x.test/api/v1/x');
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TypeError);
    expect((failure as Error).message).toBe('POST /api/v1/x got no answer');
    expect(tellsSecrets(failure)).toBe(false);
  });

  it('is so for a call with a key, a call of a session and a body that is not JSON', async () => {
    const down = callLogOf('GET', 'https://x.test/api/v1/social/me');
    for (const run of [
      () => callWith(context([down]).as, KEY, 'GET', '/api/v1/social/me'),
      () => call(context([down]).as, 'GET', '/api/v1/social/me'),
    ]) {
      const failure = await run().catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(TypeError);
      expect(tellsSecrets(failure)).toBe(false);
    }
    const html = context([{ status: 502, text: `<html>${KEY}</html>` }]);
    const notJson = await call(html.as, 'GET', '/api/v1/x').catch((error: unknown) => error);
    expect((notJson as Error).message).toBe(
      'GET /api/v1/x answered 502 with something that is not JSON',
    );
    expect(tellsSecrets(notJson)).toBe(false);
  });

  it('answers what a call answers, with the key only as `Authorization: Bearer`', async () => {
    const stand = context([{ status: 200, text: '{"ok":true}' }]);
    const answer = await callWith(stand.as, KEY, 'POST', '/api/v1/x', { a: 1 });
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ ok: true });
    expect(stand.sent).toHaveLength(1);
    expect(stand.sent[0]).toMatchObject({
      url: '/api/v1/x',
      method: 'POST',
      data: { a: 1 },
      headers: { authorization: `Bearer ${KEY}` },
    });
  });

  it('reaches the example agent as a network failure: its write is sent again with the same request ID, and nothing prints a secret', async () => {
    const stand = context([
      callLogOf('POST', 'https://x.test/api/v1/social/agents'),
      { status: 201, text: JSON.stringify(examples.agents.registration) },
    ]);
    const joined = await runAgent({
      mode: 'join',
      inviteCode: 'hz-test-test-test-test',
      handle: 'test_agent',
      name: 'Test Agent',
      api: 'https://x.test/api/v1',
      fetch: fetchThrough(stand.as),
      log: () => {},
    });
    expect(joined.handle).toBe('test_agent');
    expect(stand.sent).toHaveLength(2);
    expect(stand.sent[1]?.data).toEqual(stand.sent[0]?.data);
    // Twice, and the agent that gave up would throw the quiet error, not Playwright's.
    const lost = context([callLogOf('POST', 'https://x.test/api/v1/social/agents')]);
    const failure = await runAgent({
      mode: 'join',
      inviteCode: 'hz-test-test-test-test',
      handle: 'test_agent',
      name: 'Test Agent',
      api: 'https://x.test/api/v1',
      fetch: fetchThrough(lost.as),
      log: () => {},
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TypeError);
    expect((failure as Error).message).toBe('POST /api/v1/social/agents got no answer');
    expect(tellsSecrets(failure)).toBe(false);
  });
});

describe("the clean-up of a journey's agent", () => {
  const registered = (id: string) =>
    new Response(JSON.stringify({ agent: { id } }), { status: 201 });

  it("notes the agent's ID from its registration's answer, and changes nothing else", async () => {
    const agent: NotedAgent = { id: null };
    const noted = noteRegistration(
      async (input) =>
        String(input).endsWith('/social/agents') ? registered('agent-1') : new Response('{}'),
      agent,
    );
    const read = await noted('https://x.test/api/v1/social/me', { method: 'GET' });
    expect(await read.text()).toBe('{}');
    expect(agent.id, 'no registration, no ID').toBeNull();
    const answer = await noted('https://x.test/api/v1/social/agents', { method: 'POST' });
    expect(agent.id).toBe('agent-1');
    expect(await answer.json(), 'the answer is still whole after it was read').toEqual({
      agent: { id: 'agent-1' },
    });
  });

  it("revokes the agent's keys by its ID through the console's call, with a reason, and answers its status", async () => {
    const stand = context([{ status: 200, text: '{}' }]);
    expect(await revokeAgentKeys(stand.as, { id: 'agent-1' }, 'The journey is over')).toBe(200);
    expect(stand.sent).toHaveLength(1);
    expect(stand.sent[0]).toMatchObject({
      url: '/api/v1/admin/social/agents/agent-1/revoke-keys',
      method: 'POST',
      data: { reason: 'The journey is over' },
    });
    const refused = context([{ status: 404, text: '{}' }]);
    expect(await revokeAgentKeys(refused.as, { id: 'agent-1' }, 'x')).toBe(404);
  });

  it('answers null when no agent was registered, and 0, never a throw, when the call got no answer', async () => {
    const stand = context([callLogOf('POST', 'https://x.test/x')]);
    expect(await revokeAgentKeys(stand.as, { id: null }, 'x')).toBeNull();
    expect(stand.sent).toEqual([]);
    expect(await revokeAgentKeys(stand.as, { id: 'agent-1' }, 'x')).toBe(0);
  });
});
