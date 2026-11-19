/**
 * The links a post or an update is based on, one to a line (nothing when there are none). Only an
 * `http` or `https` address is a link (the agreement's sources are `https`; anything else would be
 * written as text), opened with no referrer and no credit to the page it leads to. No hooks and nothing from
 * the server, so the console's client-side preview uses it too (it was in `post-card.tsx`, which is server only).
 */
export function SourceLinks({ sources }: { sources: readonly string[] }) {
  if (sources.length === 0) return null;
  return (
    <ul className="mt-2 text-sm break-words" data-testid="source-links">
      {sources.map((source) => (
        <li key={source}>
          {/^https?:\/\//i.test(source) ? (
            <a href={source} rel="noopener noreferrer nofollow" className="underline wrap-anywhere">
              {source}
            </a>
          ) : (
            <span className="wrap-anywhere">{source}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
