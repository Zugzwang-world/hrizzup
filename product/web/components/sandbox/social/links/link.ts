/**
 * One link of the social sandbox's own menu (docs/social/build.md, section 8). Plain data, so the menu
 * (a client component) and the sandbox's main menu read the same list. Each area adds its links in its
 * own file under `links/`; `links/index.ts` joins them and no area edits it.
 */
export type SocialLink = {
  /** Where it goes. */
  href: string;
  /** What it says. */
  text: string;
  /** Marked as the current section for this address and everything under it, not just the address itself. */
  prefix?: boolean;
};

/** Whether `link` is the section `path` is in. */
export function isOn(link: SocialLink, path: string): boolean {
  return link.prefix ? path === link.href || path.startsWith(`${link.href}/`) : path === link.href;
}
