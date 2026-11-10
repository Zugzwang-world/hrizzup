import { TURNSTILE_SCRIPT } from './turnstile.ts';

/**
 * Cloudflare's bot-check widget (Turnstile) in the browser: its script, loaded once, and the
 * options our pages render it with. Used by the website's email-code form
 * (components/email-code-request.tsx) and by the page the app shows in a small web view
 * (components/app-bot-check.tsx). The answer is always checked by our server (lib/turnstile.ts).
 */

export type TurnstileOptions = {
  sitekey: string;
  action?: string;
  size?: 'normal' | 'flexible' | 'compact';
  theme?: 'auto' | 'light' | 'dark';
  callback?: (answer: string) => void;
  'expired-callback'?: () => void;
  'error-callback'?: () => void;
};

export type Turnstile = {
  render: (box: HTMLElement, options: TurnstileOptions) => string | undefined;
};

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let loading: Promise<Turnstile> | undefined;

/** Cloudflare's widget script, fetched once per page; a failed fetch can be tried again. */
export function loadTurnstile(): Promise<Turnstile> {
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

/** Cloudflare's normal widget is 300 pixels wide; the compact one fits a narrow phone. */
export function widgetSize(width: number): 'flexible' | 'compact' {
  return width >= 300 ? 'flexible' : 'compact';
}
