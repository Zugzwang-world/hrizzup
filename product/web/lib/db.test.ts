import { describe, expect, it } from 'vitest';
import { withoutTlsOptions } from './db.ts';

describe('withoutTlsOptions', () => {
  it('removes TLS options so the full certificate check always applies', () => {
    const out = withoutTlsOptions(
      'postgresql://user:p%40ss@pooler.example:6543/postgres?sslmode=require&sslrootcert=x&application_name=a',
    );
    expect(out).toBe('postgresql://user:p%40ss@pooler.example:6543/postgres?application_name=a');
  });
});
