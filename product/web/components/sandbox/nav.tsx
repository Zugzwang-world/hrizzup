'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { socialLinks } from './social/links/index.ts';

const LINKS = [
  {
    href: '/sandbox',
    text: 'Markets',
    on: (path: string) => path === '/sandbox' || path.startsWith('/sandbox/markets'),
  },
  {
    href: '/sandbox/perps',
    text: 'Perps',
    on: (path: string) => path.startsWith('/sandbox/perps'),
  },
  {
    href: '/sandbox/keys',
    text: 'Keys',
    on: (path: string) => path.startsWith('/sandbox/keys'),
  },
];

/**
 * Social's one link, which leads to the first page an area has added (`social/links/`, the first link of
 * the joined menu): shown only once an area has added one, so it never points at a page that isn't
 * there yet, whichever area's page lands first.
 */
const SOCIAL_HOME = socialLinks[0];

/** The sandbox's sections, the one you are in marked. */
export function SandboxNav() {
  const path = usePathname();
  const links = SOCIAL_HOME
    ? [
        ...LINKS,
        {
          href: SOCIAL_HOME.href,
          text: 'Social',
          on: (path: string) => path.startsWith('/sandbox/social'),
        },
      ]
    : LINKS;
  return (
    <nav
      aria-label="Sandbox"
      className="flex min-w-0 flex-wrap gap-x-6 font-semibold uppercase tracking-wide"
    >
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={link.on(path) ? 'page' : undefined}
          className={`inline-flex min-h-11 items-center no-underline ${
            link.on(path) ? 'text-ink underline underline-offset-8' : 'text-muted hover:text-ink'
          }`}
        >
          {link.text}
        </Link>
      ))}
    </nav>
  );
}
