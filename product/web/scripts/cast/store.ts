import { randomBytes } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  type Stats,
  writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { refuse } from './errors.ts';

/**
 * The store (rule 10): keys, codes, records and story sets live in `~/.config/hrizzup/cast/` (0700;
 * `HRIZZUP_CAST_HOME` in tests). Before every read: nothing in it is a symbolic link, it belongs to
 * this user with no group or other permissions, and no folder above it holds `.git` (so it can
 * never be committed by accident). Writing: folders 0700, files 0600, each write to a temporary
 * file that is then renamed, so an interrupted write leaves the old file whole.
 */

export const DEFAULT_HOME = join(homedir(), '.config', 'hrizzup', 'cast');

export type StoreHooks = {
  /** Called just before a written file replaces the old one (a test makes it throw to interrupt a write). */
  beforeRename?: (path: string) => void;
};

const REL = /^[A-Za-z0-9][A-Za-z0-9._@+/-]*$/;

/** Whether an error says the file or folder is not there (any more). */
function isGone(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

export class Store {
  readonly home: string;
  hooks: StoreHooks;

  constructor(home: string, hooks: StoreHooks = {}) {
    this.home = resolve(home);
    this.hooks = hooks;
  }

  /** Opens the store (making it, 0700, when it doesn't exist yet) and checks all of it. */
  static open(home: string = DEFAULT_HOME, hooks: StoreHooks = {}): Store {
    const store = new Store(home, hooks);
    store.verify();
    return store;
  }

  /** Every check of rule 10, over the whole store. Exit 2, with the fix, when one fails. */
  verify(): void {
    this.noGitAbove();
    if (!existsSync(this.home)) {
      mkdirSync(this.home, { recursive: true, mode: 0o700 });
      chmodSync(this.home, 0o700);
    }
    this.checkTree(this.home);
  }

  private noGitAbove(): void {
    for (let dir = dirname(this.home); ; dir = dirname(dir)) {
      if (existsSync(join(dir, '.git'))) {
        throw refuse(
          `The store is inside a git folder (${dir}): move it (HRIZZUP_CAST_HOME) to a folder outside every repository`,
        );
      }
      if (dirname(dir) === dir) return;
    }
  }

  /**
   * Checks one file or folder: not a link, ours, nobody else's to read. Null when it is gone: another
   * `cast` process may rename or remove a file between a listing and this look, and gone is absent.
   */
  private checkOne(path: string): Stats | null {
    let stat: Stats;
    try {
      stat = lstatSync(path);
    } catch (error) {
      if (isGone(error)) return null;
      throw error;
    }
    const where = path === this.home ? 'the store' : path.slice(this.home.length + 1);
    if (stat.isSymbolicLink()) {
      throw refuse(`${where} is a symbolic link: remove it (the store never follows one)`);
    }
    const uid = process.getuid?.();
    if (uid !== undefined && stat.uid !== uid) {
      throw refuse(`${where} does not belong to you: it is refused`);
    }
    if ((stat.mode & 0o077) !== 0) {
      throw refuse(
        `${where} has group or other permissions: fix with chmod -R go-rwx ${this.home}`,
      );
    }
    return stat;
  }

  private checkTree(path: string): void {
    const stat = this.checkOne(path);
    if (stat?.isDirectory()) {
      let names: string[];
      try {
        names = readdirSync(path);
      } catch (error) {
        if (isGone(error)) return;
        throw error;
      }
      for (const name of names) this.checkTree(join(path, name));
    }
  }

  /** The absolute path of a name inside the store; anything that could leave it is refused. */
  path(rel: string): string {
    if (
      !REL.test(rel) ||
      rel.split('/').some((part) => part === '..' || part === '.' || part === '')
    ) {
      throw refuse('That name is not one the store holds');
    }
    const full = join(this.home, rel);
    if (!full.startsWith(this.home + sep)) throw refuse('That name is outside the store');
    return full;
  }

  /** Checks a file and every folder between it and the store, one by one, right before it is read. */
  private checkChain(path: string): boolean {
    for (let dir = dirname(path); dir.startsWith(this.home); dir = dirname(dir)) {
      if (this.checkOne(dir) === null) return false;
      if (dir === this.home) break;
    }
    return this.checkOne(path) !== null;
  }

  private isLink(path: string): boolean {
    try {
      return lstatSync(path).isSymbolicLink();
    } catch {
      return false;
    }
  }

  exists(rel: string): boolean {
    const path = this.path(rel);
    return this.checkChain(path);
  }

  readText(rel: string): string | null {
    const path = this.path(rel);
    if (!this.checkChain(path)) return null;
    try {
      return readFileSync(path, 'utf8');
    } catch (error) {
      if (isGone(error)) return null;
      throw error;
    }
  }

  readBytes(rel: string): Buffer | null {
    const path = this.path(rel);
    if (!this.checkChain(path)) return null;
    try {
      return readFileSync(path);
    } catch (error) {
      if (isGone(error)) return null;
      throw error;
    }
  }

  readJson<T>(rel: string): T | null {
    const text = this.readText(rel);
    if (text === null) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw refuse(`${rel} in the store is not valid JSON: fix or remove it`);
    }
  }

  /** The names in a folder of the store (none when it doesn't exist). */
  list(rel: string): string[] {
    const path = this.path(rel);
    if (this.checkOne(path) === null) return [];
    try {
      return readdirSync(path).sort();
    } catch (error) {
      if (isGone(error)) return [];
      throw error;
    }
  }

  private makeFolders(dir: string): void {
    if (this.checkOne(dir) !== null) return;
    if (dir !== this.home) this.makeFolders(dirname(dir));
    try {
      mkdirSync(dir, { mode: 0o700 });
    } catch (error) {
      // Another process made it at the same moment: it only has to be one we accept.
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    chmodSync(dir, 0o700);
    this.checkOne(dir);
  }

  /** Writes a whole file (0600) by writing a temporary file and renaming it over the old one. */
  writeText(rel: string, text: string): void {
    const path = this.path(rel);
    this.makeFolders(dirname(path));
    if (this.isLink(path)) this.checkOne(path);
    const temporary = `${path}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
    try {
      const fd = openSync(temporary, 'wx', 0o600);
      try {
        chmodSync(temporary, 0o600);
        writeSync(fd, text);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      this.hooks.beforeRename?.(path);
      renameSync(temporary, path);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
  }

  writeJson(rel: string, value: unknown): void {
    this.writeText(rel, `${JSON.stringify(value, null, 2)}\n`);
  }

  /** Adds a line to a log (0600 when it is made). */
  append(rel: string, text: string): void {
    const path = this.path(rel);
    this.makeFolders(dirname(path));
    if (existsSync(path) || this.isLink(path)) this.checkOne(path);
    appendFileSync(path, text, { mode: 0o600 });
  }

  remove(rel: string): void {
    const path = this.path(rel);
    if (!existsSync(dirname(path))) return;
    rmSync(path, { force: true });
  }

  /** Makes a lock file holding `stamp`, only if there is none (`wx`): true when it is ours. */
  tryLock(rel: string, stamp: string): boolean {
    const path = this.path(rel);
    this.makeFolders(dirname(path));
    try {
      const fd = openSync(path, 'wx', 0o600);
      try {
        writeSync(fd, stamp);
      } finally {
        closeSync(fd);
      }
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw error;
    }
  }
}
