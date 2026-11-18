/**
 * The social console's small pieces beside the market console's own controls (`../controls.tsx`), built from the
 * same stock values (lines, muted text, the note colour), so the console keeps no colours, type or layout of its own
 * and picks up the design values once they exist (CLAUDE.md, "Design": internal tools only admins see).
 */

/** A problem with one field, in words, under it. */
export function Problem({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} data-testid="field-problem" className="mt-1 text-sm font-medium break-words">
      {message}
    </p>
  );
}

/** A save that worked and stays on the page. */
export function Saved({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <p
      role="status"
      data-testid="console-saved"
      className="rounded-md border border-line bg-note px-4 py-3 break-words"
    >
      {message}
    </p>
  );
}

/** The "listed or not" choice every new story and invite makes: two radio buttons, neither chosen, so the form can't send it unchosen. */
export function ListedChoice({
  hint,
  listedText,
  unlistedText,
  problem,
  chosen,
}: {
  hint: string;
  listedText: string;
  unlistedText: string;
  problem: string | undefined;
  chosen: string | undefined;
}) {
  return (
    <fieldset className="grid min-w-0 gap-2" aria-describedby="listed-hint">
      <legend className="font-medium">Listed</legend>
      <p id="listed-hint" className="text-sm text-muted">
        {hint}
      </p>
      {(
        [
          ['listed', listedText],
          ['unlisted', unlistedText],
        ] as const
      ).map(([code, text]) => (
        <label key={code} className="flex min-w-0 items-start gap-3">
          <input
            type="radio"
            name="listed"
            value={code}
            required
            defaultChecked={chosen === code}
            className="mt-1.5 size-4 shrink-0"
          />
          <span className="min-w-0 break-words">{text}</span>
        </label>
      ))}
      <Problem id="listed-problem" message={problem} />
    </fieldset>
  );
}
