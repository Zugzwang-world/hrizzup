import Link from 'next/link';
import { SiteFooter, SiteHeader } from '@/components/site-shell.tsx';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-4 py-16 sm:px-6">
        <h1 className="type-display">Page not found</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          There's nothing here yet.{' '}
          <Link href="/" className="underline">
            Back to the home page
          </Link>
          .
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
