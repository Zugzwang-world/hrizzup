import { brand } from '@hrizzup/core';
import { SiteFooter, SiteHeader } from '@/components/site-shell.tsx';

/**
 * The holding page: what Hrizzup is, until launch (runbook step 9.4). `data-page="holding"` is
 * how the release pipeline tells it apart: until launch it only promotes builds that show it.
 */
export default function HoldingPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main
        data-page="holding"
        className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-4 py-16 sm:px-6 sm:py-24"
      >
        <p className="type-label text-primary">Coming soon</p>
        <h1 className="type-display mt-4 max-w-[16ch] text-balance sm:text-7xl lg:text-8xl">
          {brand.headline}
        </h1>
        <p className="mt-8 max-w-[38rem] text-pretty text-lg leading-relaxed text-muted-foreground sm:text-xl">
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
