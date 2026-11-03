import { brand } from '@hrizzup/core';
import { SiteFooter, SiteHeader } from '@/components/site-shell.tsx';

/** The holding page: what Hrizzup is, until launch (runbook step 9.4). */
export default function HoldingPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-4 py-16 sm:px-6 sm:py-24">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-accent">Coming soon</p>
        <h1 className="mt-5 max-w-[16ch] text-balance font-display text-5xl leading-[1.02] tracking-tight sm:text-7xl lg:text-8xl">
          {brand.headline}
        </h1>
        <p className="mt-8 max-w-[38rem] text-pretty text-lg leading-relaxed text-muted sm:text-xl">
          {brand.summary}
        </p>
        <p className="mt-4 max-w-[38rem] text-lg leading-relaxed sm:text-xl">
          {brand.availability}
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
