import { X509Certificate } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SUPABASE_ROOT_CA } from './supabase-ca.ts';

describe('SUPABASE_ROOT_CA', () => {
  it("is Supabase's root certificate, with the fingerprint recorded in the blueprint", () => {
    const cert = new X509Certificate(SUPABASE_ROOT_CA);
    expect(cert.fingerprint256).toBe(
      '80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA',
    );
    expect(cert.subject).toContain('CN=Supabase Root 2021 CA');
    expect(cert.ca).toBe(true);
  });
});

describe('the certificate file used by tools', () => {
  it('is the same certificate as the one the website embeds', async () => {
    const { readFile } = await import('node:fs/promises');
    const file = await readFile(
      new URL('../../../infra/supabase/supabase-root-2021-ca.crt', import.meta.url),
      'utf8',
    );
    expect(new X509Certificate(file).fingerprint256).toBe(
      new X509Certificate(SUPABASE_ROOT_CA).fingerprint256,
    );
  });
});
