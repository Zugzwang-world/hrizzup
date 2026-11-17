/**
 * How social's areas join (docs/social/build.md, D10): each area's file holds the calls it owns
 * under their full paths (`{ social: { me: { inbox } } }`), and the groups that several areas feed
 * (`social.me`, `social.agents`, `admin.social`) are put together here, once, for the contract, the
 * examples' stand-in and the website's handlers alike. A call named by two areas is a mistake, and
 * stops the code from loading, so no relay can take another's.
 */

type Plain = Record<string, unknown>;

const isGroup = (value: unknown): value is Plain =>
  typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;

type Merge<A, B> = {
  [K in keyof A | keyof B]: K extends keyof A
    ? K extends keyof B
      ? Merge<A[K], B[K]>
      : A[K]
    : K extends keyof B
      ? B[K]
      : never;
};

/** The areas, joined: the groups merge, a call in two areas is refused. */
export type Joined<Areas extends readonly object[]> = Areas extends readonly [
  infer First,
  ...infer Rest extends readonly object[],
]
  ? Rest extends readonly []
    ? First
    : Merge<First, Joined<Rest>>
  : Record<string, never>;

/**
 * Joins the areas' trees of calls into one, group by group. The calls themselves are never
 * copied, so each is the very object its area made (the tests rely on it).
 */
export function joinAreas<const Areas extends readonly object[]>(...areas: Areas): Joined<Areas> {
  const joined: Plain = {};
  for (const area of areas) {
    for (const [name, value] of Object.entries(area)) {
      const have = joined[name];
      if (have === undefined) joined[name] = value;
      else if (isGroup(have) && isGroup(value)) joined[name] = joinAreas(have, value);
      else throw new Error(`"${name}" is made by two areas of social: each call has one owner`);
    }
  }
  return joined as Joined<Areas>;
}
