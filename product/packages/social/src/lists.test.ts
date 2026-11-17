import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  boardLists,
  briefLabels,
  categories,
  categoryNames,
  isCategory,
  isPlace,
  isSort,
  isTier,
  parseBoardFilters,
  placeNames,
  places,
  placesFor,
  sorts,
  tiers,
} from './lists.ts';

/** The agreement's own list file, read straight from its definitions. */
const agreement = JSON.parse(
  readFileSync(
    new URL('../../../../agreement/definitions/lists.schema.json', import.meta.url),
    'utf8',
  ),
) as { $defs: Record<string, { title: string; oneOf?: { const: string; title: string }[] }> };

const example = JSON.parse(
  readFileSync(new URL('../../api/src/social/examples/board.json', import.meta.url), 'utf8'),
) as { lists: unknown };

describe("the board's lists", () => {
  it("are the agreement's: every category and every place, with its tier", () => {
    const categoryCodes = agreement.$defs.category?.oneOf?.map((i) => i.const);
    expect(categories.map((c) => c.code)).toEqual(categoryCodes);
    for (const tier of ['global', 'national', 'local']) {
      const codes = agreement.$defs[tier]?.oneOf?.map((i) => i.const) ?? [];
      expect(codes.length).toBeGreaterThan(0);
      expect(places.filter((p) => p.tier === tier).map((p) => p.code)).toEqual(codes);
    }
    expect(places).toHaveLength(
      ['global', 'national', 'local'].reduce(
        (n, t) => n + (agreement.$defs[t]?.oneOf?.length ?? 0),
        0,
      ),
    );
    expect(tiers.map((t) => t.code)).toEqual(['global', 'national', 'local']);
  });

  it("have the agreement's own names", () => {
    expect(categoryNames().ai).toBe(
      agreement.$defs.category?.oneOf?.find((i) => i.const === 'ai')?.title,
    );
    expect(placeNames()['delhi-ncr']).toBe('Delhi NCR');
    expect(tiers.map((t) => t.name)).toEqual(
      ['global', 'national', 'local'].map((tier) => agreement.$defs[tier]?.title),
    );
    expect(briefLabels()).toEqual({ categories: categoryNames(), places: placeNames() });
  });

  it('are what the contract example says social.lists answers', () => {
    expect(boardLists()).toEqual(example.lists);
  });

  it('can not be changed through an answer', () => {
    const answer = boardLists();
    answer.categories.pop();
    answer.tiers[0]?.places.push('moon');
    expect(boardLists().categories).toHaveLength(categories.length);
    expect(boardLists().tiers[0]?.places).not.toContain('moon');
  });

  it('give each place to exactly one tier, and every place to a tier', () => {
    const owned = tiers.flatMap((t) => t.places);
    expect(new Set(owned).size).toBe(owned.length);
    expect(owned.sort()).toEqual(places.map((p) => p.code).sort());
  });
});

describe("a place filter's tiers", () => {
  it("map to the agreement's places", () => {
    expect(placesFor('local')).toEqual(places.filter((p) => p.tier === 'local').map((p) => p.code));
    expect(placesFor('national')).toEqual(['india']);
    expect(placesFor('global')).toEqual(['global']);
  });

  it('map one place to itself, and nothing else to anything', () => {
    expect(placesFor('mumbai')).toEqual(['mumbai']);
    expect(placesFor('atlantis')).toBeNull();
    expect(placesFor('')).toBeNull();
    expect(placesFor('LOCAL')).toBeNull();
    expect(placesFor(undefined)).toBeNull();
    expect(placesFor(['local'])).toBeNull();
  });

  it('hand over a copy of the places each time', () => {
    placesFor('local')?.push('moon');
    expect(placesFor('local')).not.toContain('moon');
  });

  it('cover a new list item with no change here: each place of each tier maps', () => {
    for (const tier of tiers) {
      expect(isTier(tier.code)).toBe(true);
      expect(placesFor(tier.code)).toEqual(tier.places);
      for (const code of tier.places) expect(isPlace(code)).toBe(true);
    }
    for (const category of categories) expect(isCategory(category.code)).toBe(true);
  });
});

describe("the board's input", () => {
  it('starts on Top with no filter', () => {
    expect(parseBoardFilters({})).toEqual({
      ok: true,
      filters: { sort: 'top', category: null, places: null },
    });
  });

  it('turns a tier into its places and keeps a category and a sort', () => {
    expect(parseBoardFilters({ sort: 'latest', category: 'ai', place: 'local' })).toEqual({
      ok: true,
      filters: { sort: 'latest', category: 'ai', places: placesFor('local') },
    });
    expect(parseBoardFilters({ place: 'india' })).toMatchObject({
      ok: true,
      filters: { places: ['india'] },
    });
  });

  it('refuses each field that is not from the lists, all at once', () => {
    expect(parseBoardFilters({ sort: 'hot', category: 'cooking', place: 'atlantis' })).toEqual({
      ok: false,
      issues: [
        { path: 'sort', message: expect.any(String) },
        { path: 'category', message: expect.any(String) },
        { path: 'place', message: expect.any(String) },
      ],
    });
    expect(parseBoardFilters({ place: 5 })).toMatchObject({ ok: false });
    expect(parseBoardFilters({ category: '' })).toMatchObject({ ok: false });
  });

  it('knows the sorts', () => {
    expect(sorts).toEqual(['top', 'latest']);
    expect(isSort('top')).toBe(true);
    expect(isSort('best')).toBe(false);
  });
});
