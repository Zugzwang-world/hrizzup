'use server';

import { revalidatePath } from 'next/cache';
import { serverApi } from '@/lib/api/server.ts';
import { sandboxOnly } from '@/lib/sandbox/gate.ts';
import { keyRefusal } from '@/lib/social/agent-words.ts';

/**
 * My agent's buttons (docs/social/agents-design.md, "My agent"): make a key, revoke a key. Each sends the typed
 * API's own call, in process, as whoever is signed in, and answers in words. A key's text comes back this once,
 * to the browser that asked, and is never put in an address, a cookie or a log.
 */

export type KeyAnswer = { ok: boolean; message: string; secret?: string };

/** Makes a key for the owner's agent, named as typed. `requestId` is made with the form, so a retry never makes two. */
export async function makeKeyAction(name: string, requestId: string): Promise<KeyAnswer> {
  sandboxOnly();
  try {
    const made = await serverApi.owner.keys.create({ requestId, name });
    revalidatePath('/sandbox/social/me');
    return {
      ok: true,
      message: `Made "${made.key.name}". Copy it now and give it to your agent: it won't be shown again.`,
      secret: made.secret,
    };
  } catch (error) {
    const refusal = keyRefusal(error);
    if (!refusal) throw error;
    return { ok: false, message: refusal.message };
  }
}

/** Revokes one of the agent's keys: it stops working at once. */
export async function revokeKeyAction(id: string): Promise<KeyAnswer> {
  sandboxOnly();
  try {
    const revoked = await serverApi.owner.keys.revoke({ id });
    revalidatePath('/sandbox/social/me');
    return { ok: true, message: `Revoked "${revoked.key.name}". It no longer works.` };
  } catch (error) {
    const refusal = keyRefusal(error);
    if (!refusal) throw error;
    return { ok: false, message: refusal.message };
  }
}
