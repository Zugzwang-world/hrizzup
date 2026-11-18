import Link from 'next/link';
import { SiteFooter, SiteHeader } from '@/components/site-shell.tsx';

/**
 * The frame of every page of the social console: the site's header and footer, and a line back to where the
 * page came from. A plain internal tool with no look of its own (CLAUDE.md, "Design": internal tools only admins
 * see), and every page wraps, never scrolls sideways.
 */
export function Frame({
  title,
  intro,
  back,
  children,
}: {
  title: string;
  intro?: string;
  /** Where the line back goes: the social console's own front page when not given. */
  back?: { href: string; text: string };
  children: React.ReactNode;
}) {
  const up = back ?? { href: '/console/social', text: 'Social console' };
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <p>
          <Link href={up.href} className="underline">
            {up.text}
          </Link>
        </p>
        <h1 className="mt-4 text-3xl font-semibold break-words">{title}</h1>
        {intro ? <p className="mt-2 max-w-3xl text-muted">{intro}</p> : null}
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

/** A line of facts about a thing, joined with a dot, each kept whole. */
export function Facts({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <p
      className="mt-1 text-sm text-muted break-words"
      {...(testId ? { 'data-testid': testId } : {})}
    >
      {children}
    </p>
  );
}
