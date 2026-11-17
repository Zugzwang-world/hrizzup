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
 * Social's one link, which leads to its first page: shown only once an area has added a link of its own
 * (`social/links/`), so it never points at a page that isn't there yet.
 */
const SOCIAL = {
  href: '/sandbox/social',
  text: 'Social',
  on: (path: string) => path.startsWith('/sandbox/social'),
};

/** The sandbox's sections, the one you are in marked. */
export function SandboxNav() {
  const path = usePathname();
  const links = socialLinks.length > 0 ? [...LINKS, SOCIAL] : LINKS;
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
