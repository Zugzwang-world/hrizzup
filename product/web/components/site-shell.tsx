import { brand } from '@hrizzup/core';
import Link from 'next/link';
import { currentEnvironment } from '@/lib/env.ts';

/** A small note on every page outside production, so nobody mistakes staging for the live site. */
function EnvironmentNote() {
  const env = currentEnvironment();
  if (env === 'production') return null;
  return (
    <div className="bg-notice text-notice-foreground border-b border-border">
      <p className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm sm:px-6">
        <span className="font-semibold uppercase tracking-wide">{env}</span>
        <span className="text-muted-foreground">Not the live site.</span>
        <Link href="/sign-in-test" className="underline">
          Sign-in test
        </Link>
        <a href="/api/health" className="underline">
          Health
        </a>
      </p>
    </div>
  );
}

export function SiteHeader() {
  return (
    <>
      <EnvironmentNote />
      <header className="mx-auto flex w-full max-w-5xl items-center px-4 pt-6 sm:px-6 sm:pt-8">
        <Link href="/" className="type-brand no-underline">
          {brand.name}
        </Link>
      </header>
    </>
  );
}

export function SiteFooter() {
  return (
    <footer className="mx-auto w-full max-w-5xl px-4 pb-8 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border pt-6 text-sm text-muted-foreground">
        <p>© 2026 {brand.name}</p>
        <nav aria-label="Legal" className="flex flex-wrap gap-x-6 gap-y-2">
          <Link href="/privacy" className="underline hover:text-foreground">
            Privacy
          </Link>
          <Link href="/terms" className="underline hover:text-foreground">
            Terms
          </Link>
        </nav>
      </div>
    </footer>
  );
}
