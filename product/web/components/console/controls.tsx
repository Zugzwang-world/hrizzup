/**
 * The market console's controls: the browser's own fields and buttons, styled only with the site's
 * existing values (lines, muted text, the note colour), so the console has no colours, type or
 * layout of its own and picks up the design values once they exist (PLAN.md section 3, "Design":
 * internal tools only admins see).
 */

export const FIELD =
  'mt-1 block w-full min-w-0 rounded-md border border-line bg-paper px-3 py-2 text-base';
export const BUTTON =
  'min-h-11 rounded-md border border-line px-5 font-medium hover:bg-note disabled:opacity-60';

/** A labelled field, with a hint under its label. */
export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="font-medium">
        {label}
      </label>
      {hint && (
        <p id={`${htmlFor}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {children}
    </div>
  );
}

/** Why the last attempt was refused. */
export function Refusal({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      data-testid="console-refusal"
      className="rounded-md border border-line bg-note px-4 py-3 break-words"
    >
      {message}
    </p>
  );
}
