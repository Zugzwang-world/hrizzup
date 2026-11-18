import { describe, expect, it } from 'vitest';
import { localDatabaseOrThrow } from './local-database.ts';

/** The guard of R5's database tests: only a database on this Mac, as pg itself would read the address. */

const local = [
  'postgresql://postgres:postgres@127.0.0.1:55352/postgres',
  'postgresql://postgres:postgres@localhost:5432/postgres',
  'postgres://postgres:postgres@127.0.0.1/postgres',
];

const elsewhere = [
  // Another host, in the places a lookalike hides.
  'postgresql://postgres:x@db.example.supabase.co:5432/postgres',
  'postgresql://postgres:x@aws-0-ap-south-1.pooler.supabase.com:6543/postgres',
  'postgresql://postgres:x@127.0.0.1.example.com:5432/postgres',
  'postgresql://postgres:x@localhost.example.com/postgres',
  'postgresql://127.0.0.1:x@db.example.supabase.co:5432/postgres',
  'postgresql://postgres:x@10.0.0.5:5432/postgres',
  'postgresql://postgres:x@[::1]:5432/postgres',
  'nothing like one',
  '',
  // The host exactly, as pg would connect to it: no other spelling.
  'postgresql://postgres@LOCALHOST:5432/postgres',
  // pg lets a query override the host: `new URL(address).hostname` would say 127.0.0.1 here.
  'postgresql://postgres:x@127.0.0.1:5432/postgres?host=db.example.supabase.co',
  'postgresql://postgres:x@localhost/postgres?host=db.example.supabase.co&port=5432',
  'postgresql://postgres:x@127.0.0.1/postgres?hostaddr=203.0.113.9',
  'postgresql://postgres:x@127.0.0.1/postgres?options=-c%20search_path%3Dx',
  'postgresql://postgres:x@127.0.0.1/postgres?sslmode=disable',
  'postgresql://postgres:x@127.0.0.1/postgres#?host=db.example.supabase.co',
  // A unix socket: a path, or an encoded path as the host, or no host at all (pg then reads PGHOST).
  '/var/run/postgresql postgres',
  'postgresql://postgres:x@%2Fvar%2Frun%2Fpostgresql/postgres',
  'postgresql:///postgres',
  'postgresql://postgres:x@/postgres',
  'socket:/var/run/postgresql?db=postgres',
];

describe('the guard of the database tests', () => {
  it('lets a database on this Mac through, by 127.0.0.1 or localhost', () => {
    for (const address of local) {
      expect(() => localDatabaseOrThrow(address), address).not.toThrow();
    }
  });

  it('stops any other host, a query that overrides the host, and a unix socket, before a connection is made', () => {
    for (const address of elsewhere) {
      expect(() => localDatabaseOrThrow(address), address).toThrow();
    }
  });

  it('never prints the address it refuses: it holds a password', () => {
    for (const address of elsewhere) {
      try {
        localDatabaseOrThrow(address);
      } catch (error) {
        const said = error instanceof Error ? error.message : '';
        expect(address !== '' && said.includes(address), 'the message holds the address').toBe(
          false,
        );
      }
    }
  });
});
