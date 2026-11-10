import { brand } from '@hrizzup/core';
import Link from 'next/link';
import { EnvironmentNote } from '@/components/site-shell.tsx';
import { money } from '@/lib/console-format.ts';
import { viewer } from '@/lib/sandbox/data.ts';
import { SandboxNav } from './nav.tsx';

/**
 * The sandbox's header, as Kalshi's top bar is laid out: our name, Markets and Perps, and on the
 * right the signed-in account's play-money balance, the console for admins, and sign in or out.
 * Signing in goes through the sign-in test page, which returns here.
 */
export async function SandboxHeader() {
  const who = await viewer();
  return (
    <>
      <EnvironmentNote />
      <header className="border-b border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-8 gap-y-1 px-4 py-2 sm:px-6">
          <Link
            href="/sandbox"
            className="font-display text-3xl leading-none tracking-tight no-underline"
          >
            {brand.name}
          </Link>
          <SandboxNav />
          <div className="ml-auto flex flex-wrap items-center gap-x-5 text-sm">
            {who.signedIn ? (
              <>
                <span className="font-semibold tabular-nums" data-testid="sandbox-balance">
                  {who.balance === null ? 'Balance unavailable' : money(who.balance)}
                </span>
                {who.admin && (
                  <Link href="/console" className="inline-flex min-h-11 items-center underline">
                    Console
                  </Link>
                )}
                <form action="/auth/sign-out" method="post">
                  <button type="submit" className="min-h-11 underline">
                    Sign out
                  </button>
                </form>
              </>
            ) : (
              <Link
                href="/sign-in-test?next=/sandbox"
                className="inline-flex min-h-11 items-center rounded-md border border-line px-4 font-medium no-underline hover:bg-note"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>
    </>
  );
}
