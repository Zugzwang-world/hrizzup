import lists from '@hrizzup/agreement/definitions/lists.schema.json' with { type: 'json' };

/**
 * The board's filters, made from the hand-over agreement's shared lists (docs/social/build.md, D5):
 * what a story is about (a category), where it matters (a place, one place or a tier of them) and how
 * the board is ordered (a sort). The categories, the places and the tiers are read from
 * `agreement/definitions/lists.schema.json`, the only place they are defined, so **a new list item
 * needs no change here**: the founder-approved item in the agreement shows up in the board's lists,
 * its filters and the brief's names by itself.
 *
 * - **A category** is a code from the agreement's category list (`ai`, `sports`...).
 * - **A place** is a code from its location list (`india`, `mumbai`...), and each place belongs to one
 *   **tier**: `global`, `national` or `local`, which are the three lists the location list is made of.
 * - **A place filter** names a place or a tier. A tier stands for all of its places, so `local` shows
 *   the stories about any local place. (`global` is both a tier and the one place in it: the same
 *   filter either way.) The database is given the list of places, never the tier.
 * - **No Node-only code,** so a page may import this file (`@hrizzup/social/lists`).
 */

type Item = { const: string; title: string };
type Part = { title: string; oneOf: readonly Item[] };
type Definitions = Record<string, Part>;
type Reference = { $ref: string };

const definitions = lists.$defs as unknown as Definitions;

const part = (name: string): Part => {
  const found = definitions[name];
  if (!found) throw new Error(`The agreement's shared lists have no ${name}`);
  return found;
};

export type Category = { code: string; name: string };
export type Place = { code: string; name: string; tier: string };
export type Tier = { code: string; name: string; places: string[] };
/** The answer of `social.lists`: everything a board filter offers. */
export type Lists = {
  categories: Category[];
  places: Place[];
  tiers: Tier[];
  sorts: readonly (typeof sorts)[number][];
};

/** How the board is ordered: Top by default. */
export const sorts = ['top', 'latest'] as const;
export type Sort = (typeof sorts)[number];
export const DEFAULT_SORT: Sort = 'top';

/** The tiers' names, in the order the location list gives them: the `$ref`s of its `anyOf`. */
const tierNames: string[] = (lists.$defs.location.anyOf as readonly Reference[]).map((ref) => {
  const name = ref.$ref.replace('#/$defs/', '');
  part(name);
  return name;
});

export const categories: readonly Category[] = part('category').oneOf.map((item) => ({
  code: item.const,
  name: item.title,
}));

export const tiers: readonly Tier[] = tierNames.map((tier) => ({
  code: tier,
  name: part(tier).title,
  places: part(tier).oneOf.map((item) => item.const),
}));

export const places: readonly Place[] = tierNames.flatMap((tier) =>
  part(tier).oneOf.map((item) => ({ code: item.const, name: item.title, tier })),
);

/** `social.lists`'s answer, as the contract's `Lists` has it. A new copy each time, so no one can change the lists. */
export function boardLists(): Lists {
  return {
    categories: categories.map((c) => ({ ...c })),
    places: places.map((p) => ({ ...p })),
    tiers: tiers.map((t) => ({ ...t, places: [...t.places] })),
    sorts,
  };
}

export const isCategory = (value: unknown): value is string =>
  typeof value === 'string' && categories.some((c) => c.code === value);
export const isPlace = (value: unknown): value is string =>
  typeof value === 'string' && places.some((p) => p.code === value);
export const isTier = (value: unknown): value is string =>
  typeof value === 'string' && tiers.some((t) => t.code === value);
export const isSort = (value: unknown): value is Sort =>
  typeof value === 'string' && (sorts as readonly string[]).includes(value);

/** Every category's name by its code, for the words a brief or a page writes. */
export function categoryNames(): Record<string, string> {
  return Object.fromEntries(categories.map((c) => [c.code, c.name]));
}

/** Every place's name by its code. */
export function placeNames(): Record<string, string> {
  return Object.fromEntries(places.map((p) => [p.code, p.name]));
}

/** The names `buildBrief` writes categories and places with. */
export function briefLabels(): {
  categories: Record<string, string>;
  places: Record<string, string>;
} {
  return { categories: categoryNames(), places: placeNames() };
}

/**
 * The places a place filter stands for: a tier's places, or the one place; null when the text is
 * neither. A tier is looked at first, so a tier and a place of one name mean the tier.
 */
export function placesFor(filter: unknown): string[] | null {
  if (typeof filter !== 'string') return null;
  const tier = tiers.find((t) => t.code === filter);
  if (tier) return [...tier.places];
  return isPlace(filter) ? [filter] : null;
}

/** A refused filter: the field's path and what is wrong, as the API's `data.issues` has them. */
export type FilterIssue = { path: 'sort' | 'category' | 'place'; message: string };

export type BoardFilters = {
  sort: Sort;
  /** A category code, or null for every category. */
  category: string | null;
  /** The places to match (a story about any of them), or null for every place. */
  places: string[] | null;
};

/**
 * The board's input, checked and turned into what the database takes (`social.board(sort, category,
 * places, ...)`): a missing `sort` is Top, a missing `category` or `place` is no filter. Each refused
 * field is an issue, all of them at once.
 */
export function parseBoardFilters(input: {
  sort?: unknown;
  category?: unknown;
  place?: unknown;
}): { ok: true; filters: BoardFilters } | { ok: false; issues: FilterIssue[] } {
  const issues: FilterIssue[] = [];
  const sort = input.sort ?? DEFAULT_SORT;
  if (!isSort(sort)) issues.push({ path: 'sort', message: `Must be one of ${sorts.join(', ')}` });
  const category = input.category ?? null;
  if (category !== null && !isCategory(category)) {
    issues.push({ path: 'category', message: 'Must be a category code from the lists' });
  }
  const place = input.place ?? null;
  const wanted = place === null ? null : placesFor(place);
  if (place !== null && wanted === null) {
    issues.push({ path: 'place', message: 'Must be a place code or a tier from the lists' });
  }
  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    filters: { sort: sort as Sort, category: category as string | null, places: wanted },
  };
}
