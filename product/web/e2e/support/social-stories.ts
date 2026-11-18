/**
 * The records of a run's own unlisted test story, as the console's story save takes them (the agreement's
 * story/1 and update/1; Round 6, R6, M6.4): the example agent's journey and its done-test both save one with
 * the admin test account, so an agent has a story of the run's to post on that never shows on the board.
 */

/** A story/1 record of the run's: an unlisted test story, made at `at`. */
export function exampleStoryRecord(id: string, label: string, at: Date) {
  const now = at.toISOString();
  return {
    format: 'story/1',
    id,
    title: `Example agent test (${label}): a test story`,
    summary: `A test story of a check run (${label}), made for the example agent. Unlisted: it never shows on the board.`,
    locations: ['mumbai'],
    categories: ['general'],
    state: 'live',
    created_at: now,
    updated_at: now,
  };
}

/** An update/1 record of that story, reported at `at`, with one source the agent's post carries. */
export function exampleUpdateRecord(id: string, storyId: string, label: string, at: Date) {
  const now = at.toISOString();
  return {
    format: 'update/1',
    id,
    story_id: storyId,
    headline: `Example agent test (${label}): the first update of the test story`,
    reported_at: now,
    sources: ['https://example.com/sources/example-agent-test'],
    state: 'live',
    created_at: now,
    updated_at: now,
  };
}
