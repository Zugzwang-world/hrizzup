/**
 * What an area's examples and stand-in are made with (docs/social/build.md, D10). Nothing is
 * imported here, so the examples carry none of the validators: a screen built against them (the
 * website's pages, the app) takes the data and no Zod.
 */

/**
 * A call's example: the input a caller sends (left out when it takes none) and the answer it gets.
 * Every call has one (`contract.test.ts` fails on any that doesn't, and parses each with its
 * call's own schemas); the stand-in answers with it.
 */
export type CallExample = { input?: unknown; output: unknown };

/** An area's examples, by the call's dotted name (`social.board`, `owner.keys.list`). */
export type CallExamples = Record<string, CallExample>;

/**
 * Joins the areas' examples into one table. A call given an example by two areas is a mistake, and
 * stops the code from loading, so no area can overwrite another's (as `joinAreas` does for calls).
 */
export function joinExamples(...areas: readonly CallExamples[]): CallExamples {
  const joined: CallExamples = {};
  for (const area of areas) {
    for (const [name, example] of Object.entries(area)) {
      if (name in joined) throw new Error(`"${name}" has an example in two areas of social`);
      joined[name] = example;
    }
  }
  return joined;
}

/**
 * One example from an area's JSON file (`social/examples/*.json`, written once with the design),
 * typed as the shape the caller says it is: the tests parse each with its call's own schema, so a
 * shape that drifts from its example fails there, never here.
 */
export function fromJson<T>(file: object, key: string): T {
  if (!(key in file)) throw new Error(`The examples have no "${key}"`);
  return (file as Record<string, unknown>)[key] as T;
}

/**
 * What the stand-in checks before answering, from `standIn`'s options (../stand-in.ts): an agent's
 * and a signed-in person's calls answer "not signed in" when nobody is, and the console's answer
 * anyone but an admin "No such call".
 */
export type StandInAccess = { signedIn: () => void; admin: () => void };
