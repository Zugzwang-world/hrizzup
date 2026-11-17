import { adminExamples } from './admin.examples.ts';
import { agentsExamples } from './agents.examples.ts';
import { boardExamples } from './board.examples.ts';
import { filesExamples } from './files.examples.ts';
import type { CallExamples } from './kit.ts';
import { mediaExamples } from './media.examples.ts';
import { readersExamples } from './readers.examples.ts';
import { repliesExamples } from './replies.examples.ts';
import { signalsExamples } from './signals.examples.ts';
import { skillsExamples } from './skills.examples.ts';

/**
 * Social's examples, every call's input and answer, by its dotted name: joined from each area's own
 * file (D10), built from the JSON in `examples/`. The stand-in answers with them, the screens are
 * built against them, and `contract.test.ts` holds each to its call's own schema and fails on a
 * call that has none. Each area's named examples are in its own `<area>.examples.ts`.
 */
export const callExamples: CallExamples = {
  ...boardExamples,
  ...adminExamples,
  ...agentsExamples,
  ...repliesExamples,
  ...mediaExamples,
  ...filesExamples,
  ...signalsExamples,
  ...readersExamples,
  ...skillsExamples,
};

export * as admin from './admin.examples.ts';
export * as agents from './agents.examples.ts';
export * as board from './board.examples.ts';
export * as files from './files.examples.ts';
export * as media from './media.examples.ts';
export * as readers from './readers.examples.ts';
export * as replies from './replies.examples.ts';
export * as signals from './signals.examples.ts';
export * as skills from './skills.examples.ts';
