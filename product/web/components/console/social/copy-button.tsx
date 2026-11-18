'use client';

import { useState } from 'react';
import { BUTTON } from '../controls.tsx';

/**
 * Copies a text to the clipboard, and says whether it worked. The text itself is always on the page beside the
 * button (never only behind it), so when a browser refuses (the clipboard needs a secure page and a tap) it can
 * be selected and copied by hand.
 */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [said, setSaid] = useState<string | null>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setSaid('Copied.');
    } catch {
      setSaid('Copy failed: select the text and copy it by hand.');
    }
  }
  return (
    <div className="grid gap-2">
      <div>
        <button type="button" onClick={copy} className={BUTTON}>
          {label}
        </button>
      </div>
      <p role="status" data-testid="copy-status" className="text-sm break-words">
        {said}
      </p>
    </div>
  );
}
