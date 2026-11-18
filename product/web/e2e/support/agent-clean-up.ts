import type { APIRequestContext } from '@playwright/test';
import { call } from './quiet-request.ts';

/**
 * The clean-up of a journey that makes an agent (Round 6, R6): the agent's keys are revoked, whatever happened
 * and at whatever step it stopped, through the console's live call `agents.revokeKeys` (R5's `POST
 * /api/v1/admin/social/agents/{id}/revoke-keys`), which takes the agent's ID and works before a claim too. The
 * ID comes from the registration's own answer, noted as it goes past, so a run that failed before it asked for
 * anything else can still clean up. Nothing here handles a key's text.
 */

/** Where the agent's ID is kept once its registration has answered. */
export type NotedAgent = { id: string | null };

/** A `fetch` that notes the ID of the agent a registration answers, and changes nothing else about it. */
export function noteRegistration(through: typeof fetch, into: NotedAgent): typeof fetch {
  return async (input, init) => {
    const response = await through(input, init);
    if (init?.method === 'POST' && new URL(String(input)).pathname === '/api/v1/social/agents') {
      const answer = (await response
        .clone()
        .json()
        .catch(() => null)) as { agent?: { id?: unknown } } | null;
      if (typeof answer?.agent?.id === 'string') into.id = answer.agent.id;
    }
    return response;
  };
}

/**
 * Revokes every live key of the noted agent, as the console's admin. It answers the call's status (0 when
 * the call got no answer), or null when no agent was ever registered, so nothing needs revoking. It never
 * throws, so a clean-up can't hide the failure that came first; the caller checks the status is 200.
 */
export async function revokeAgentKeys(
  admin: APIRequestContext,
  agent: NotedAgent,
  reason: string,
): Promise<number | null> {
  if (agent.id === null) return null;
  return call(admin, 'POST', `/api/v1/admin/social/agents/${agent.id}/revoke-keys`, {
    reason,
  }).then(
    (answer) => answer.status,
    () => 0,
  );
}
