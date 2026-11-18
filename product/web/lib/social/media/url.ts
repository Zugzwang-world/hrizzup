/**
 * Where media is served from (docs/social/media-design.md, 7.7): `MEDIA_BASE_URL`, the media host's address,
 * and a file's address is that plus `/` plus its key. Server only (it reads the environment). With no valid
 * base, nothing is served: a picture is left out rather than shown from a wrong address.
 */

type Env = Readonly<Record<string, string | undefined>>;

const BASE = /^https:\/\/[a-z0-9.-]+(:\d{1,5})?$/;

/** The media host's address with no final `/`, or null when it isn't set or isn't a plain `https://host[:port]`. */
export function mediaBase(env: Env = process.env): string | null {
  const given = env.MEDIA_BASE_URL?.trim().replace(/\/$/, '');
  return given !== undefined && BASE.test(given) ? given : null;
}

/** The address of a file of the media bucket by its key, or null when there is no valid base. */
export function mediaPublicUrl(key: string, env: Env = process.env): string | null {
  const base = mediaBase(env);
  return base === null ? null : `${base}/${key}`;
}
