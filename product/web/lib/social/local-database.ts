import { createRequire } from 'node:module';

/**
 * The guard of R5's database tests (`*.db.test.ts`): they seed accounts, an admin, agents and stories with
 * the database's own login, so each runs only on a database on this Mac (the slot's), never on one it was
 * pointed at by mistake. Any other address stops it, loudly, before a connection is made.
 *
 * The address is read as pg reads it, by pg's own parser (`pg-connection-string`, pg's dependency, found
 * from pg's own place since this package doesn't list it), never by `new URL(address).hostname`: pg lets a
 * `?host=` in the query override the host before it (`postgresql://u@127.0.0.1/db?host=db.x.supabase.co`
 * connects to that host), and a path is a unix socket. So the host pg would connect to must be exactly
 * `127.0.0.1` or `localhost` (an address with no host at all would fall back to `PGHOST`, so it is
 * refused too), and the address carries no query at all: nothing after it can override what is before it
 * (`host`, `hostaddr`, `port`, `options`, `service`). Nothing here prints the address: it holds a password.
 */

type Parsed = { host?: string | null };

/** pg's own parser of an address, found from pg's place so no new dependency is listed for a test guard. */
const { parse } = createRequire(createRequire(import.meta.url).resolve('pg'))(
  'pg-connection-string',
) as { parse: (address: string) => Parsed };

/** The only hosts a database test may connect to. */
export const LOCAL_DATABASE_HOSTS: readonly string[] = ['127.0.0.1', 'localhost'];

/** Throws unless `address` is a database on this Mac, as pg would read it; says nothing of the address. */
export function localDatabaseOrThrow(address: string): void {
  let host: string | null | undefined;
  try {
    host = parse(address).host;
  } catch {
    throw new Error('SOCIAL_DATABASE_URL is not an address');
  }
  if (address.includes('?')) {
    throw new Error(
      'SOCIAL_DATABASE_URL must carry no query (?host=…): pg lets a query override the host',
    );
  }
  if (host === null || host === undefined || !LOCAL_DATABASE_HOSTS.includes(host)) {
    throw new Error(
      'SOCIAL_DATABASE_URL must be a database on this Mac (127.0.0.1 or localhost): this test writes accounts and an admin to it',
    );
  }
}
