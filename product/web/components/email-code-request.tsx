'use client';

import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { EMAIL_CODE_ACTION, TURNSTILE_SCRIPT } from '@/lib/turnstile.ts';

type TurnstileOptions = {
  sitekey: string;
  action?: string;
  size?: 'normal' | 'flexible' | 'compact';
  callback?: (answer: string) => void;
  'expired-callback'?: () => void;
  'error-callback'?: () => void;
};

type Turnstile = { render: (box: HTMLElement, options: TurnstileOptions) => string | undefined };

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let loading: Promise<Turnstile> | undefined;

/** Cloudflare's widget script, fetched once, the first time someone starts the form. */
function loadTurnstile(): Promise<Turnstile> {
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    if (window.turnstile) {
      resolve(window.turnstile);
      return;
    }
    const script = document.createElement('script');
    script.src = `${TURNSTILE_SCRIPT}?render=explicit`;
    script.async = true;
    script.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile missing'));
    script.onerror = () => {
      loading = undefined;
      reject(new Error('Turnstile failed to load'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

type State = 'idle' | 'checking' | 'ready' | 'waiting' | 'sending' | 'failed';

const MESSAGES: Partial<Record<State, string>> = {
  waiting: "Checking you're not a bot…",
  sending: 'Sending your code…',
  failed: "The bot check couldn't run. Reload the page and try again.",
};

/**
 * The email step of signing in with a code: the address, the bot check (Cloudflare Turnstile)
 * and the button. The widget's script loads only once the visitor starts on the form, so the
 * page opens without it (blueprint section 14). The widget puts its answer in the form as
 * `cf-turnstile-response`, and the form posts to our server (app/auth/email/code/route.ts),
 * which checks it before anything is emailed. A click before the answer is ready waits for
 * it, then sends.
 */
export function EmailCodeRequest({ siteKey, next }: { siteKey: string; next: string }) {
  const form = useRef<HTMLFormElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const answer = useRef<string | null>(null);
  const started = useRef(false);
  const sendWhenReady = useRef(false);
  const [state, setState] = useState<State>('idle');

  // A page the browser brings back from its back-forward cache keeps this state: a form that
  // was sending would stay locked, with an answer Cloudflare has already used. Start afresh.
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener('pageshow', restored);
    return () => window.removeEventListener('pageshow', restored);
  }, []);

  const start = useCallback(() => {
    if (started.current) return;
    started.current = true;
    setState('checking');
    loadTurnstile().then(
      (turnstile) => {
        const target = box.current;
        if (!target) return;
        turnstile.render(target, {
          sitekey: siteKey,
          action: EMAIL_CODE_ACTION,
          // Cloudflare's normal widget is 300 pixels wide; the compact one fits a narrow phone.
          size: target.clientWidth >= 300 ? 'flexible' : 'compact',
          callback: (value) => {
            answer.current = value;
            setState('ready');
            if (sendWhenReady.current) {
              sendWhenReady.current = false;
              form.current?.requestSubmit();
            }
          },
          'expired-callback': () => {
            answer.current = null;
            sendWhenReady.current = false;
            setState('checking');
          },
          'error-callback': () => {
            // Cloudflare may retry on its own; a later answer must not send by itself.
            answer.current = null;
            sendWhenReady.current = false;
            setState('failed');
          },
        });
      },
      () => setState('failed'),
    );
  }, [siteKey]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (state === 'sending') {
      event.preventDefault(); // already on its way: the answer works only once
      return;
    }
    if (answer.current) {
      setState('sending'); // the browser posts the form, with the widget's answer
      return;
    }
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    sendWhenReady.current = true;
    start();
    setState((current) => (current === 'failed' ? 'failed' : 'waiting'));
  }

  const message = MESSAGES[state];
  return (
    <form
      ref={form}
      action="/auth/email/code"
      method="post"
      onSubmit={onSubmit}
      onFocus={start}
      onPointerDown={start}
      className="mt-6 grid gap-3"
    >
      <input type="hidden" name="next" value={next} />
      <label htmlFor="sign-in-email" className="text-sm font-medium">
        Email address
      </label>
      <input
        id="sign-in-email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        maxLength={254}
        className="min-h-11 w-full min-w-0 rounded-md border border-line bg-transparent px-3 py-2"
      />
      <div ref={box} data-testid="bot-check" className="max-w-full overflow-hidden" />
      <button
        type="submit"
        aria-disabled={state === 'sending'}
        className="min-h-11 justify-self-start rounded-md border border-line px-5 font-medium hover:bg-note aria-disabled:opacity-60"
      >
        Email me a code
      </button>
      <p aria-live="polite" className="min-h-6 text-sm text-muted">
        {message}
      </p>
    </form>
  );
}
