import { Fragment } from 'react';

/**
 * The docs' text, as the guides write it (lib/api-docs/guide.ts): `code` in backticks and **bold**
 * in double stars, nothing else. Long code breaks anywhere, so no line ever sticks out of a phone's
 * window.
 */
export function Text({ children }: { children: string }) {
  const parts = children.split(/(`[^`]+`|\*\*[^*]+\*\*)/);
  return (
    <>
      {parts.map((part, i) => {
        const key = `${i}:${part}`;
        if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
          return (
            <code
              key={key}
              className="rounded-sm bg-note px-1 font-mono text-[0.9em] wrap-anywhere"
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        if (part.startsWith('**') && part.endsWith('**') && part.length > 3) {
          return <strong key={key}>{part.slice(2, -2)}</strong>;
        }
        return <Fragment key={key}>{part}</Fragment>;
      })}
    </>
  );
}
