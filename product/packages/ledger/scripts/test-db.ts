/**
 * The ledger's database tests (src/*.db.test.ts), part of the Database check:
 *
 *   pnpm --filter @hrizzup/ledger test:db      (or `pnpm test:db` for every database test)
 *
 * They run against the local database built from the migrations: on this Mac, this
 * worktree's slot (claim one first: CLAUDE.md, "Parallel sessions"); in GitHub's runners, the
 * database `config.toml` describes. The database is started if it isn't running (the
 * Database check's own tests come first, but Turborepo skips them when nothing they read has
 * changed), and its address reaches the tests as LEDGER_DATABASE_URL.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const slot = `${root}infra/slots/slot`;
const inGitHub = process.env.GITHUB_ACTIONS === 'true';

/** The local database's port: the slot's on this Mac, config.toml's in GitHub. */
function port(): string {
  if (!inGitHub) {
    const settings = execFileSync('python3', [slot, 'env'], { encoding: 'utf8' });
    const found = /^export SUPABASE_DB_PORT=(\d+)$/m.exec(settings)?.[1];
    if (!found) throw new Error('This worktree holds no slot: run `infra/slots/slot claim` first');
    return found;
  }
  const config = readFileSync(`${root}infra/supabase/config.toml`, 'utf8');
  const db = config.slice(config.indexOf('\n[db]'));
  const found = /^port = (\d+)$/m.exec(db)?.[1];
  if (!found) throw new Error('config.toml names no port for [db]');
  return found;
}

execFileSync('python3', [slot, 'db', 'start'], { stdio: 'inherit' });
execFileSync(
  `${fileURLToPath(new URL('../node_modules/.bin/vitest', import.meta.url))}`,
  ['run', '--config', 'vitest.db.config.ts'],
  {
    stdio: 'inherit',
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: {
      ...process.env,
      // The local database's own login, the same on every machine (Supabase CLI's default).
      LEDGER_DATABASE_URL: `postgresql://postgres:postgres@127.0.0.1:${port()}/postgres`,
    },
  },
);
