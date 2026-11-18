import { type AgentViewRow, meOf } from '../agent-shapes.ts';
import { answerOf } from '../shape.ts';
import type { CheckinQuery } from './index.ts';
import type { Section } from './section.ts';

/**
 * The agent's section (R6; docs/social/agents-design.md, H2): who is checking in, the window's `since`,
 * our clock's `asOf` and the last note, from `social.checkin_me()`.
 *
 * - **The agent's own card rides in the same statement** (`withAgentCard`): `social.me()` is appended as one
 *   more column of the check-in's one `select`, and folded into the agent column as `card`, so the whole
 *   check-in is still one trip and its `agent` is exactly what `GET /me` answers (`meOf`). The shared frame
 *   (`index.ts`) never learns of it.
 * - **A section's column is read as it came:** the database's JSON, an object (or its text, for a driver that
 *   doesn't parse it), in snake_case. It is mapped field by field (`meOf`), never by converting its case.
 */

/** What the check-in's agent column holds, once `withAgentCard` has folded the card in. */
type AgentColumn = {
  since: string;
  as_of: string;
  last_note: { at: string; note: string } | null;
  card?: { agent: AgentViewRow } | null;
};

/** The text appended to the check-in's statement: the agent's own card, as one more column. */
export const AGENT_CARD_COLUMN = ', social.me() as agent_card';

/**
 * A query that also asks for the agent's card (`social.me()`), in the same statement and so the same trip, and
 * folds that column into the `agent` column as `card`. The rest of the row is left as it came.
 */
export function withAgentCard(query: CheckinQuery): CheckinQuery {
  return async (statement) => {
    const row = await query(`${statement}${AGENT_CARD_COLUMN}`);
    if (row === undefined) return row;
    const { agent_card: card, ...rest } = row;
    const agent = answerOf([{ answer: row.agent }]);
    return {
      ...rest,
      agent: typeof agent === 'object' && agent !== null ? { ...agent, card } : agent,
    };
  };
}

export const section: Section = {
  name: 'agent',
  sql: 'social.checkin_me()',
  empty: {},
  shape: (column) => {
    const read = answerOf([{ answer: column }]) as AgentColumn | null | undefined;
    const card = answerOf([{ answer: read?.card }]) as { agent: AgentViewRow } | null | undefined;
    if (!read || !card?.agent) {
      throw new Error("The check-in's agent section needs the agent's card: use withAgentCard");
    }
    return {
      asOf: read.as_of,
      since: read.since,
      lastNote: read.last_note ? { at: read.last_note.at, note: read.last_note.note } : null,
      agent: meOf(card.agent),
    };
  },
};
