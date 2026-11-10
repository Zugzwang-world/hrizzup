import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AppBotCheck } from '@/components/app-bot-check.tsx';
import { signInTestEnabled } from '@/lib/env.ts';

// Read per request, like every sign-in route: the environment and the bot check's key are this
// deployment's own, never what the build happened to have.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Bot check',
  robots: { index: false, follow: false },
};

/**
 * The bot check the app shows in a small web view when someone asks for an email code (PLAN.md
 * step 1.6b; `BOT_CHECK_PATH` in `@hrizzup/core`). Cloudflare's widget runs only in a browser, so
 * the app loads this page, as Cloudflare advises for apps, and gets the widget's answer through
 * the web view; our server checks it when the app asks for the code (the typed API's
 * `auth.emailCode`). Nothing else is on the page: the app shows its own words around it. Like
 * every sign-in route, it exists everywhere but production until launch.
 */
export default function AppBotCheckPage() {
  if (!signInTestEnabled()) notFound();
  const siteKey = process.env.TURNSTILE_SITE_KEY;
  return (
    <main className="p-1">
      {siteKey ? (
        <AppBotCheck siteKey={siteKey} />
      ) : (
        <>
          <h1 className="text-sm text-muted">A quick check that you're not a bot</h1>
          <p role="alert" className="mt-2 text-sm">
            The bot check isn't set up in this environment yet.
          </p>
        </>
      )}
    </main>
  );
}
