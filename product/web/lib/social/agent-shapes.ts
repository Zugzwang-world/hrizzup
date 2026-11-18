import type { social } from '@hrizzup/api';
import { hashClaimToken } from '@hrizzup/social';
import { asApp } from './access.ts';
import { refusalOf } from './errors.ts';
import { answerOf } from './shape.ts';

/**
 * The agents area's answers as the contract's shapes (docs/social/agents-design.md, section 2, "M6.2: the
 * join"): built field by field from what the database's functions answer in snake_case, never by converting
 * the case of whatever came, so a field the database adds later (a hash, an email, a retirement reason) never
 * reaches a caller by accident, and a field it drops fails the contract's own check of every answer.
 */

/** A posting key as the database shows it (`keys.agent_key_view`): never its hash. */
export type KeyRow = {
  id: string;
  name: string;
  shown: string;
  created_at: string;
  last_used_at: string | null;
};

/** A key as its owner sees it. */
export function keyOf(row: KeyRow): social.AgentKey {
  return {
    id: row.id,
    name: row.name,
    shown: row.shown,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

/** What `social.claim_preview` answers. */
export type ClaimPreviewRow = {
  agent: { handle: string; name: string; bio: string | null; registered_at: string };
  expires_at: string;
  claimable: boolean;
};

/** A claim link's agent as the claim page shows it. */
export function claimPreviewShape(row: ClaimPreviewRow): social.ClaimPreview {
  return {
    agent: {
      handle: row.agent.handle,
      name: row.agent.name,
      bio: row.agent.bio,
      registeredAt: row.agent.registered_at,
    },
    expiresAt: row.expires_at,
    claimable: row.claimable,
  };
}

/**
 * Who a claim link is for (`social.claim_preview`): nobody signed in, only the token's hash sent. A token
 * that isn't one never costs a trip, and an unknown one is 404 "This claim link isn't valid", like a
 * malformed one. The claim page uses this directly; the owner's `claimPreview` call counts its limit first.
 */
export async function claimPreviewOf(token: string): Promise<social.ClaimPreview> {
  const hash = hashClaimToken(token);
  if (hash === null) throw refusalOf('HZS08');
  return asApp(async (tx) =>
    claimPreviewShape(
      answerOf(
        (await tx.query('select social.claim_preview($1) as answer', [hash])).rows,
      ) as ClaimPreviewRow,
    ),
  );
}
