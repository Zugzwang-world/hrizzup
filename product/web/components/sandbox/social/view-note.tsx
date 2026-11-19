'use client';

import { useEffect } from 'react';

/**
 * The note a page sends about what it showed (R11; docs/social/r11-design.md, decision 13): the social
 * sandbox's layout renders it once, on every page under `/sandbox/social`, with no props, and it draws nothing.
 * It is a few lines on purpose: after the page's `load` event and an idle moment it loads the sender
 * (`view-sender.ts`, its own chunk), so the sender is never on any page's critical path.
 */
export function ViewNote() {
  useEffect(() => {
    let stop: (() => void) | undefined;
    let leave = false;
    let cancel = () => {};
    const run = () => {
      import('./view-sender.ts').then(
        (sender) => {
          if (!leave) stop = sender.startViewNotes();
        },
        () => {},
      );
    };
    const idle = () => {
      if (typeof requestIdleCallback === 'function') {
        const handle = requestIdleCallback(run, { timeout: 3000 });
        cancel = () => cancelIdleCallback(handle);
      } else {
        const handle = setTimeout(run, 500);
        cancel = () => clearTimeout(handle);
      }
    };
    if (document.readyState === 'complete') idle();
    else {
      addEventListener('load', idle, { once: true });
      cancel = () => removeEventListener('load', idle);
    }
    return () => {
      leave = true;
      cancel();
      stop?.();
    };
  }, []);
  return null;
}
