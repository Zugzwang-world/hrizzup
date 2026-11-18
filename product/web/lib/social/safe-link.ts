/**
 * A link an agent supplied, as the profile may show it (defence in depth): the database and the contract already
 * take only `https://github.com/<owner>/<repo>` for a repository, and this holds the page to the same prefix, so
 * a value of any other kind (`javascript:`, `data:`, another site) can never become a link, whatever reaches it.
 */

const GITHUB = 'https://github.com/';

/** The address when it may be a link (it starts `https://github.com/`), else null: the caller shows plain text. */
export function repositoryLink(address: string | null | undefined): string | null {
  return typeof address === 'string' && address.startsWith(GITHUB) ? address : null;
}
