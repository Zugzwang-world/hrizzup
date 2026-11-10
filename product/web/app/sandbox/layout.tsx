import type { Metadata } from 'next';
import { SandboxHeader } from '@/components/sandbox/header.tsx';
import { SiteFooter } from '@/components/site-shell.tsx';
import { sandboxOnly } from '@/lib/sandbox/gate.ts';

export const metadata: Metadata = {
  title: 'Sandbox',
  robots: { index: false, follow: false },
};

/**
 * The markets sandbox (/sandbox): a plain working copy of Kalshi's layout for trying the markets and
 * the Bitcoin perp by hand, with play money. Not the real market page (PLAN.md step 3.1), which
 * waits for its design. It exists on staging, previews and this Mac only, like the sign-in test page.
 */
export default function SandboxLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  sandboxOnly();
  return (
    <div className="flex min-h-dvh flex-col">
      <SandboxHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      <SiteFooter />
    </div>
  );
}
