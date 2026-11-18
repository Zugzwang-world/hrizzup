import { categories, places, tiers } from '@hrizzup/social/lists';

/**
 * The lists a new-story form chooses from, read from the hand-over agreement's own (`@hrizzup/social/lists`, so a
 * founder-approved item in the agreement shows here by itself): the categories, and the places grouped by their
 * tier. Plain data for the form, which is a client component and imports none of the lists itself.
 */
export function storyChoices(): {
  categories: { code: string; name: string }[];
  places: { tier: string; places: { code: string; name: string }[] }[];
} {
  return {
    categories: categories.map(({ code, name }) => ({ code, name })),
    places: tiers.map((tier) => ({
      tier: tier.name,
      places: places
        .filter((place) => place.tier === tier.code)
        .map(({ code, name }) => ({ code, name })),
    })),
  };
}
