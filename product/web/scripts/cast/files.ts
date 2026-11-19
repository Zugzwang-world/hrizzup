import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { Ctx } from './context.ts';
import { refuse } from './errors.ts';
import { type Entry, findMember, keyFile, type Member, readCast } from './members.ts';

/**
 * Where the commands read files from. Bodies, uploads and their descriptions come only from
 * `<store>/work/`, story sets only from `<store>/stories/`. A path is first taken from where `pnpm`
 * was run (`INIT_CWD`), and used when it lands inside the folder; any other relative name (`meme.png`,
 * `run-1/meme.png`) is the folder's own; an absolute path outside the folder is refused.
 */
export function inFolder(ctx: Ctx, folder: 'work' | 'stories', name: string): string {
  if (!name || name.includes('\0')) throw refuse(`Give a file in the store's ${folder}/ folder`);
  const root = `${ctx.store.home}${sep}${folder}`;
  const absolute = resolve(ctx.cwd, name);
  if (absolute.startsWith(root + sep)) {
    return relative(ctx.store.home, absolute).split(sep).join('/');
  }
  // A path that is not absolute and not inside the folder where pnpm ran is the folder's own (`run-1/meme.png`).
  if (!isAbsolute(name) && !name.includes('\\')) return `${folder}/${name}`;
  throw refuse(`The file must be in ${root}`);
}

/** A JSON object from a file in `work/`, or from standard input when the name is `-`. */
export async function readBody(ctx: Ctx, source: string): Promise<Record<string, unknown>> {
  const text =
    source === '-' ? await ctx.stdin() : ctx.store.readText(inFolder(ctx, 'work', source));
  if (text === null) throw refuse("That body file is not in the store's work/ folder");
  if (text.length > 1_000_000) throw refuse('That body is too big');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw refuse('The body is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw refuse('The body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

/** A made member: its list entry and its posting key. Refuses when `make` hasn't run for it. */
export function memberOf(ctx: Ctx, name: string): { member: Member; entry: Entry; key: string } {
  const member = findMember(name);
  if (!member) throw refuse(`${name} is not a member of the cast`);
  const entry = readCast(ctx.store).members[member.key];
  if (!entry) throw refuse(`${name} is not a member of the cast`);
  const key = ctx.store.readText(keyFile(entry.handle))?.trim();
  if (!key) throw refuse(`${name} has no key in the store: run \`make\` first`);
  return { member, entry, key };
}
