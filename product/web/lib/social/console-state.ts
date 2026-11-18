/**
 * What a social console form is in after it is sent, and the state it starts in. A file of its own with nothing
 * imported, because the forms (client components) need the starting state in the browser, and the rest of
 * `console-forms.ts` (the agreement's checker, the API's errors) is for the server only: a client file never
 * imports a value from there.
 */

/** What a form shows after it is sent. */
export type SocialFormState = {
  /** A line on the last attempt as a whole: why it was refused, or null. */
  error: string | null;
  /** A problem with one field, by the form's own name for it: the line shows under the field. */
  problems: Record<string, string>;
  /** Everything typed, to show it again so it can be fixed. */
  values: Record<string, string>;
  /** A made invite, shown once: its code, the ready message and whose it is. */
  made?: { code: string; message: string; email: string };
  /** The open invite that stands in the way of a new one for the same email. */
  clash?: { id: string; email: string };
  /** A line for a save that worked and stays on the page. */
  saved?: string;
  /** A new ID for the next send: after a save that stays on the page, the old one has done its work. */
  nextId?: string;
};

export const START: SocialFormState = { error: null, problems: {}, values: {} };

/**
 * The ID the form's next send carries (a story's update, or an invite's request): the new one a save gave
 * (`nextId`), else the one the last send carried (`values[name]`, which a refusal keeps), else the one the page
 * first rendered. A save has used its ID up, so after one the next send never carries it again, even when a refused
 * send comes between; a refused send, which saved nothing, carries its own again, so sending it twice is still one.
 */
export function sendId(state: SocialFormState, name: string, first: string): string {
  return state.nextId ?? state.values[name] ?? first;
}
