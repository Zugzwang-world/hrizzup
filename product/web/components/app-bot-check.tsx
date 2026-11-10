'use client';

import { type BotCheckMessage, botCheckMessage } from '@hrizzup/core';
import { useEffect, useRef, useState } from 'react';
import { EMAIL_CODE_ACTION } from '@/lib/turnstile.ts';
import { loadTurnstile, widgetSize } from '@/lib/turnstile-widget.ts';

declare global {
  interface Window {
    /** Present only inside the app's web view (react-native-webview). */
    ReactNativeWebView?: { postMessage: (message: string) => void };
  }
}

/** Tells the app, when this page is in its web view; anywhere else it says nothing. */
function tell(message: BotCheckMessage) {
  window.ReactNativeWebView?.postMessage(botCheckMessage(message));
}

/**
 * The bot check for the app's web view (PLAN.md step 1.6b; `@hrizzup/core`'s bot-check.ts). It
 * starts at once, so the check runs while the person types their address, and hands each
 * one-time answer to the app, which sends it to our server with the address; our server checks it
 * with Cloudflare, as for the website's own form. The same action as the website's form, since
 * it's for the same thing: an email code.
 */
export function AppBotCheck({ siteKey }: { siteKey: string }) {
  const content = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const target = box.current;
    const all = content.current;
    if (!target || !all) return;
    // The app sizes its web view to the page's content (not the window, which the page fills), so
    // it learns the content's height, with the page's own margin below, whenever it changes.
    const sizes = new ResizeObserver(() =>
      tell({ kind: 'height', height: all.getBoundingClientRect().bottom + all.offsetTop }),
    );
    sizes.observe(all);
    let gone = false;
    loadTurnstile().then(
      (turnstile) => {
        if (gone) return;
        turnstile.render(target, {
          sitekey: siteKey,
          action: EMAIL_CODE_ACTION,
          size: widgetSize(target.clientWidth),
          theme: 'auto',
          callback: (answer) => tell({ kind: 'answer', answer }),
          // Cloudflare makes a new answer by itself once one runs out.
          'expired-callback': () => tell({ kind: 'expired' }),
          'error-callback': () => {
            setFailed(true);
            tell({ kind: 'error' });
          },
        });
      },
      () => {
        if (gone) return;
        setFailed(true);
        tell({ kind: 'error' });
      },
    );
    return () => {
      gone = true;
      sizes.disconnect();
    };
  }, [siteKey]);

  return (
    <div ref={content}>
      <h1 className="text-sm text-muted">A quick check that you're not a bot</h1>
      <div ref={box} data-testid="bot-check" className="mt-2 max-w-full overflow-hidden" />
      {failed && (
        <p role="alert" className="mt-2 text-sm">
          The bot check couldn't run. Check your connection, then try again.
        </p>
      )}
    </div>
  );
}
