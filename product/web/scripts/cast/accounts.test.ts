import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRunAccount } from '../../e2e/support/test-accounts.ts';

/**
 * `createRunAccount`'s `existingOk` (the cast's `make` runs again after a stop): Supabase's 422 for an
 * account that already exists counts as done and answers null; every other failure still throws, and the
 * callers that don't ask for it are unchanged. Staging isn't involved: its answers are made up.
 */

const answer = vi.hoisted(() => ({
  next: null as { status: number; code?: string } | null,
  calls: [] as unknown[],
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      admin: {
        createUser: async (attributes: unknown) => {
          answer.calls.push(attributes);
          return answer.next
            ? { data: { user: null }, error: answer.next }
            : { data: { user: { id: 'a-made-up-id' } }, error: null };
        },
      },
    },
  }),
}));

const KEYS = { url: 'https://example.invalid', publishableKey: 'p', secretKey: 's' };
const EMAIL = 'delivered+run-cast-explainer@resend.dev';

beforeEach(() => {
  answer.next = null;
  answer.calls = [];
});

describe('createRunAccount with existingOk', () => {
  it('answers null for the 422 of an account that exists (either code), and changes nothing', async () => {
    for (const code of ['email_exists', 'user_already_exists']) {
      answer.next = { status: 422, code };
      expect(await createRunAccount(KEYS, EMAIL, { existingOk: true })).toBeNull();
    }
    expect(answer.calls).toHaveLength(2);
  });

  it('still throws for any other refusal, and for that 422 when it was not asked for', async () => {
    answer.next = { status: 422, code: 'email_exists' };
    await expect(createRunAccount(KEYS, EMAIL)).rejects.toThrow("Couldn't create");
    await expect(createRunAccount(KEYS, EMAIL, { existingOk: false })).rejects.toThrow(
      "Couldn't create",
    );
    for (const refusal of [
      { status: 422, code: 'weak_password' },
      { status: 422 },
      { status: 400, code: 'email_exists' },
      { status: 500 },
      { status: 403 },
    ]) {
      answer.next = refusal;
      await expect(createRunAccount(KEYS, EMAIL, { existingOk: true })).rejects.toThrow(
        "Couldn't create",
      );
    }
  });

  it('makes the account and answers its id when it is new, as every caller already gets', async () => {
    expect(await createRunAccount(KEYS, EMAIL)).toBe('a-made-up-id');
    expect(await createRunAccount(KEYS, EMAIL, { existingOk: true })).toBe('a-made-up-id');
    expect(answer.calls[0]).toMatchObject({
      email: EMAIL,
      email_confirm: true,
      app_metadata: { test_account: true },
    });
  });

  it("still refuses an address that is not one of the runs' own", async () => {
    await expect(
      createRunAccount(KEYS, 'someone@example.com', { existingOk: true }),
    ).rejects.toThrow("Not one of the runs' own addresses");
    expect(answer.calls).toEqual([]);
  });
});
