import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Paths another process has just removed: the real file system still has them, the store is told they are gone. */
const gone = vi.hoisted(() => ({ paths: new Set<string>() }));

vi.mock('node:fs', async (original) => {
  const real = await original<typeof import('node:fs')>();
  const missing = () => Object.assign(new Error('gone'), { code: 'ENOENT' });
  return {
    ...real,
    lstatSync: (path: string, ...rest: unknown[]) => {
      if (gone.paths.has(String(path))) throw missing();
      return (real.lstatSync as (...args: unknown[]) => unknown)(path, ...rest);
    },
    readFileSync: (path: string, ...rest: unknown[]) => {
      if (gone.paths.has(`read:${String(path)}`)) throw missing();
      return (real.readFileSync as (...args: unknown[]) => unknown)(path, ...rest);
    },
  };
});

import { CastError } from './errors.ts';
import { Store } from './store.ts';

/** Test group 3: the store. */

let outer: string;
let home: string;

beforeEach(() => {
  outer = realpathSync(mkdtempSync(join(tmpdir(), 'cast-store-')));
  home = join(outer, 'store');
});

afterEach(() => {
  gone.paths.clear();
  vi.restoreAllMocks();
  rmSync(outer, { recursive: true, force: true });
});

const mode = (path: string) => statSync(path).mode & 0o777;

const refusedWith = (work: () => unknown, text: RegExp) => {
  try {
    work();
  } catch (error) {
    expect(error).toBeInstanceOf(CastError);
    expect((error as CastError).exit).toBe(2);
    expect((error as CastError).message).toMatch(text);
    return;
  }
  throw new Error('it was not refused');
};

describe('the store', () => {
  it('is made 0700, and everything written to it is 0600 in folders of 0700', () => {
    const store = Store.open(home);
    expect(mode(home)).toBe(0o700);
    store.writeText('keys/hztest_a', 'a key\n');
    store.writeJson('cast.json', { a: 1 });
    store.append('log/run-1.jsonl', '{}\n');
    expect(mode(join(home, 'keys'))).toBe(0o700);
    expect(mode(join(home, 'log'))).toBe(0o700);
    expect(mode(join(home, 'keys/hztest_a'))).toBe(0o600);
    expect(mode(join(home, 'cast.json'))).toBe(0o600);
    expect(mode(join(home, 'log/run-1.jsonl'))).toBe(0o600);
    expect(store.readText('keys/hztest_a')).toBe('a key\n');
    expect(store.readJson('cast.json')).toEqual({ a: 1 });
    expect(Store.open(home).list('keys')).toEqual(['hztest_a']);
  });

  it('refuses a symbolic link anywhere in it, when opened and right before a read', () => {
    const store = Store.open(home);
    store.writeText('keys/real', 'x');
    const target = join(outer, 'elsewhere');
    writeFileSync(target, 'y', { mode: 0o600 });
    symlinkSync(target, join(home, 'keys/link'));
    refusedWith(() => Store.open(home), /symbolic link/);
    refusedWith(() => store.readText('keys/link'), /symbolic link/);
    rmSync(join(home, 'keys/link'));

    // A folder that is a link, planted after the store was opened.
    mkdirSync(join(outer, 'other-folder'), { mode: 0o700 });
    rmSync(join(home, 'keys'), { recursive: true });
    symlinkSync(join(outer, 'other-folder'), join(home, 'keys'));
    refusedWith(() => store.readText('keys/real'), /symbolic link/);
    refusedWith(() => store.writeText('keys/new', 'z'), /symbolic link/);
  });

  it('refuses a store that is itself a link', () => {
    mkdirSync(join(outer, 'real'), { mode: 0o700 });
    symlinkSync(join(outer, 'real'), home);
    refusedWith(() => Store.open(home), /symbolic link/);
  });

  it('refuses group or other permissions, with the fix', () => {
    const store = Store.open(home);
    store.writeText('keys/a', 'x');
    chmodSync(join(home, 'keys/a'), 0o640);
    refusedWith(() => Store.open(home), /chmod -R go-rwx/);
    refusedWith(() => store.readText('keys/a'), /group or other permissions/);
    chmodSync(join(home, 'keys/a'), 0o600);
    chmodSync(join(home, 'keys'), 0o750);
    refusedWith(() => Store.open(home), /group or other permissions/);
    chmodSync(join(home, 'keys'), 0o700);
    chmodSync(home, 0o755);
    refusedWith(() => Store.open(home), /group or other permissions/);
  });

  it('refuses what does not belong to this user', () => {
    Store.open(home).writeText('a', 'x');
    const uid = process.getuid?.() ?? 0;
    vi.spyOn(process, 'getuid').mockReturnValue(uid + 1);
    refusedWith(() => Store.open(home), /does not belong to you/);
  });

  it('refuses a store inside a git folder, however far above', () => {
    mkdirSync(join(outer, '.git'));
    refusedWith(() => Store.open(join(outer, 'a', 'b', 'store')), /git folder/);
    refusedWith(() => Store.open(home), /git folder/);
    expect(existsSync(home)).toBe(false);
  });

  it('refuses a name that could leave it', () => {
    const store = Store.open(home);
    for (const name of [
      '../x',
      '/etc/passwd',
      'keys/../../x',
      'a//b',
      '.hidden/..',
      '',
      'keys/.',
      'a b',
    ]) {
      refusedWith(() => store.readText(name), /not one the store holds|outside/);
      refusedWith(() => store.writeText(name, 'x'), /not one the store holds|outside/);
    }
  });

  it('keeps the old file whole when a write is interrupted, and leaves no temporary file', () => {
    const store = Store.open(home);
    store.writeText('cast.json', 'the old file, whole\n');
    store.hooks.beforeRename = () => {
      throw new Error('the power went');
    };
    expect(() => store.writeText('cast.json', 'half of the new fi')).toThrow('the power went');
    store.hooks.beforeRename = undefined;
    expect(store.readText('cast.json')).toBe('the old file, whole\n');
    expect(readdirSync(home)).toEqual(['cast.json']);
    // The same for a file that did not exist before: nothing appears.
    store.hooks.beforeRename = () => {
      throw new Error('again');
    };
    expect(() => store.writeText('keys/new', 'x')).toThrow('again');
    store.hooks.beforeRename = undefined;
    expect(store.readText('keys/new')).toBeNull();
  });

  it('answers null for what is not there, and removes what is', () => {
    const store = Store.open(home);
    expect(store.readText('nothing')).toBeNull();
    expect(store.readJson('nothing')).toBeNull();
    expect(store.exists('keys/a')).toBe(false);
    store.writeText('keys/a', 'x');
    expect(store.exists('keys/a')).toBe(true);
    store.remove('keys/a');
    store.remove('keys/a');
    store.remove('missing-folder/a');
    expect(store.exists('keys/a')).toBe(false);
  });

  it('counts a file that another process just removed as absent, never as a fault', () => {
    const store = Store.open(home);
    store.writeText('keys/a', 'x');
    store.writeText('keys/b', 'y');
    // Gone at the look (a rename between the listing and the check).
    gone.paths.add(join(home, 'keys/a'));
    expect(() => Store.open(home)).not.toThrow();
    expect(store.readText('keys/a')).toBeNull();
    expect(store.exists('keys/a')).toBe(false);
    expect(store.list('keys')).toEqual(['a', 'b']);
    gone.paths.clear();
    // Gone between the check and the read.
    gone.paths.add(`read:${join(home, 'keys/b')}`);
    expect(store.readText('keys/b')).toBeNull();
    expect(store.readBytes('keys/b')).toBeNull();
    gone.paths.clear();
    expect(store.readText('keys/b')).toBe('y');
  });

  it('refuses a JSON file that is cut short, naming the file and not its words', () => {
    const store = Store.open(home);
    store.writeText('cast.json', '{"half": ');
    refusedWith(() => store.readJson('cast.json'), /cast\.json in the store is not valid JSON/);
  });
});
