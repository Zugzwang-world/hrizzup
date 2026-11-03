import { describe, expect, it } from 'vitest';
import { DatabaseAddressError, databaseAddress, withoutTlsOptions } from './db.ts';

describe('withoutTlsOptions', () => {
  it('removes TLS options so the full certificate check always applies', () => {
    const out = withoutTlsOptions(
      'postgresql://user:p%40ss@pooler.example:6543/postgres?sslmode=require&sslrootcert=x&application_name=a',
    );
    expect(out).toBe('postgresql://user:p%40ss@pooler.example:6543/postgres?application_name=a');
  });
});

describe('databaseAddress', () => {
  // Exactly what Supabase's Connect dialog shows for the transaction pooler.
  const dashboard =
    'postgresql://postgres.abcdefghijklmnopqrst:[YOUR-PASSWORD]@aws-1-ap-south-1.pooler.supabase.com:6543/postgres';

  it('fills the password into the string copied from the dashboard', () => {
    expect(databaseAddress({ DATABASE_URL: dashboard, SUPABASE_DB_PASSWORD: 'Abc123xyz' })).toBe(
      'postgresql://postgres.abcdefghijklmnopqrst:Abc123xyz@aws-1-ap-south-1.pooler.supabase.com:6543/postgres',
    );
  });

  it('percent-encodes a password with special characters, which pg decodes back', () => {
    const out = databaseAddress({ DATABASE_URL: dashboard, SUPABASE_DB_PASSWORD: 'p@ss/w:rd#?%' });
    expect(out).toContain(':p%40ss%2Fw%3Ard%23%3F%25@');
    expect(decodeURIComponent(new URL(out ?? '').password)).toBe('p@ss/w:rd#?%');
  });

  it('ignores spaces copied around the string, and drops TLS options', () => {
    const out = databaseAddress({
      DATABASE_URL: `  ${dashboard}?sslmode=disable \n`,
      SUPABASE_DB_PASSWORD: 'x',
    });
    expect(out).toBe(
      'postgresql://postgres.abcdefghijklmnopqrst:x@aws-1-ap-south-1.pooler.supabase.com:6543/postgres',
    );
  });

  it('uses a complete address as it is', () => {
    const full = 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';
    expect(databaseAddress({ DATABASE_URL: full })).toBe(full);
  });

  it('is null where the database is not configured', () => {
    expect(databaseAddress({})).toBeNull();
    expect(databaseAddress({ DATABASE_URL: '  ' })).toBeNull();
  });

  it('refuses the placeholder without a password, without showing any value', () => {
    expect(() => databaseAddress({ DATABASE_URL: dashboard })).toThrow(DatabaseAddressError);
    expect(() => databaseAddress({ DATABASE_URL: dashboard })).toThrow(/SUPABASE_DB_PASSWORD/);
  });

  it('refuses a string with the placeholder more than once', () => {
    expect(() =>
      databaseAddress({
        DATABASE_URL: `${dashboard}?x=[YOUR-PASSWORD]`,
        SUPABASE_DB_PASSWORD: 'secret-value',
      }),
    ).toThrow(/exactly once/);
  });
});
