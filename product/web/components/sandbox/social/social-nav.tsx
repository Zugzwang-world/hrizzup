'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isOn, type SocialLink } from './links/link.ts';

/**
 * The social sandbox's own menu, under the sandbox's: each area's links (`links/`), the section you are
 * in marked. Shows nothing while no area has a link.
 */
export function SocialNav({ links }: { links: readonly SocialLink[] }) {
  const path = usePathname();
  if (links.length === 0) return null;
  return (
    <nav aria-label="Social" className="mb-4 flex min-w-0 flex-wrap gap-x-6">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={isOn(link, path) ? 'page' : undefined}
          className={`inline-flex min-h-11 items-center no-underline ${
            isOn(link, path) ? 'text-ink underline underline-offset-8' : 'text-muted hover:text-ink'
          }`}
        >
          {link.text}
        </Link>
      ))}
    </nav>
  );
}
