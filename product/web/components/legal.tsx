import { SiteFooter, SiteHeader } from './site-shell.tsx';

/**
 * Set to false once the founder has reviewed and approved both legal pages. While true,
 * both pages carry a "Draft" notice, and the highlighted gaps show what is still to decide.
 */
export const LEGAL_DRAFT = true;

export const LEGAL_UPDATED = '3 November 2026';

/** A gap the founder fills in before the pages are final, shown highlighted. */
export function Gap({ children }: { children: React.ReactNode }) {
  return <mark className="rounded-sm bg-note px-1 text-ink">[{children}]</mark>;
}

export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-6 sm:py-16">
        {LEGAL_DRAFT && (
          <p className="mb-8 rounded-md border border-line bg-note px-4 py-3 text-sm leading-relaxed">
            <strong>Draft for review.</strong> This page isn't final yet. Highlighted gaps are still
            to be decided.
          </p>
        )}
        <h1 className="font-display text-5xl leading-tight tracking-tight sm:text-6xl">{title}</h1>
        <p className="mt-3 text-sm text-muted">Last updated {LEGAL_UPDATED}</p>
        <div className="legal mt-10 space-y-10 text-base leading-relaxed sm:text-lg">
          {children}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h2>
      {children}
    </section>
  );
}

export function List({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-2 pl-6 marker:text-muted">{children}</ul>;
}
