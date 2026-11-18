'use server';

import { redirect } from 'next/navigation';
import { serverApi, whoAmI } from '@/lib/api/server.ts';
import { sandboxOnly } from '@/lib/sandbox/gate.ts';
import { claimRefusal } from '@/lib/social/agent-words.ts';

/**
 * The claim page's one button (docs/social/agents-design.md, C3 to C5): the signed-in owner claims the agent
 * the link is for, through the typed API's own `owner.claim`, in process, as whoever is signed in (the call
 * itself purges what the claim made stale and forgets the agent's check-in copy). A refusal comes back as
 * words (C4) for the form to show; a claim that goes through leads to My agent.
 */

export type ClaimState = { message: string; reason: string | null } | null;

export async function claimAction(_previous: ClaimState, form: FormData): Promise<ClaimState> {
  sandboxOnly();
  const field = (name: string) => {
    const value = form.get(name);
    return typeof value === 'string' ? value : '';
  };
  try {
    await serverApi.owner.claim({
      requestId: field('requestId'),
      token: field('token'),
      ownerName: field('ownerName'),
    });
  } catch (error) {
    const refusal = claimRefusal(error, (await whoAmI())?.email ?? null);
    if (!refusal) throw error;
    return refusal;
  }
  // Outside the try: `redirect` works by throwing.
  redirect('/sandbox/social/me');
}
