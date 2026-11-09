import { consoleMarketWithLog } from '@hrizzup/api/examples';
import { DatabaseBusyError } from '@hrizzup/db';
import { ConsoleError } from '@hrizzup/markets';
import { createRouterClient, ORPCError } from '@orpc/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The market console's calls in the website's API (lib/api/console.ts): to anyone but an admin,
 * signed in or not, and whatever they send, each answers exactly as an address the API doesn't
 * have; on production, to everyone. The database's own checks are tested with the database
 * (product/packages/markets and infra/supabase/tests); here, who is signed in, whether they're an
 * admin, and each call's answer are stood in for.
 */

const signedIn = vi.fn();
const isAdmin = vi.fn();
const getMarket = vi.fn();
const createMarket = vi.fn();

vi.mock('./context.ts', () => ({ signedIn: (headers: Headers) => signedIn(headers) }));
vi.mock('@/lib/db.ts', () => ({ database: () => ({ connect: vi.fn() }) }));
vi.mock('@hrizzup/markets', async (original) => ({
  ...(await original<typeof import('@hrizzup/markets')>()),
  isAdmin: (...args: unknown[]) => isAdmin(...args),
  getMarket: (...args: unknown[]) => getMarket(...args),
  createMarket: (...args: unknown[]) => createMarket(...args),
}));

const { router } = await import('./router.ts');
const { toApiError } = await import('./console.ts');

const api = () => createRouterClient(router, { context: { headers: new Headers() } });
const ADMIN = { id: '00000000-0000-4000-8000-0000000000c1', email: 'ada@console.test' };

beforeEach(() => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VERCEL_TARGET_ENV', 'staging');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

/** The API's answer to an address it doesn't have. */
const noSuchCall = { code: 'NOT_FOUND', status: 404, message: 'No such call' };

describe("the market console's calls", () => {
  it('answer an admin, after the database says the account is one', async () => {
    signedIn.mockResolvedValue(ADMIN);
    isAdmin.mockResolvedValue(true);
    getMarket.mockResolvedValue(consoleMarketWithLog);
    await expect(api().admin.markets.get({ id: consoleMarketWithLog.id })).resolves.toEqual(
      consoleMarketWithLog,
    );
    expect(isAdmin).toHaveBeenCalledWith(expect.anything(), ADMIN.id);
    expect(getMarket).toHaveBeenCalledWith(expect.anything(), ADMIN.id, consoleMarketWithLog.id);
  });

  it("answer anyone else, signed in or not, as an address the API doesn't have", async () => {
    signedIn.mockResolvedValue(null);
    await expect(api().admin.markets.get({ id: consoleMarketWithLog.id })).rejects.toMatchObject(
      noSuchCall,
    );
    signedIn.mockResolvedValue({ ...ADMIN, id: '00000000-0000-4000-8000-0000000000c2' });
    isAdmin.mockResolvedValue(false);
    await expect(api().admin.markets.get({ id: consoleMarketWithLog.id })).rejects.toMatchObject(
      noSuchCall,
    );
    expect(getMarket).not.toHaveBeenCalled();
  });

  it('check who is asking before reading what they sent, so a bad input gives nothing away', async () => {
    signedIn.mockResolvedValue({ ...ADMIN, id: '00000000-0000-4000-8000-0000000000c2' });
    isAdmin.mockResolvedValue(false);
    await expect(
      api().admin.markets.create({ question: 'not a market at all' } as never),
    ).rejects.toMatchObject(noSuchCall);
    signedIn.mockResolvedValue(null);
    await expect(api().admin.markets.get({ id: 'not-an-id' })).rejects.toMatchObject(noSuchCall);
    // An admin's bad input, by contrast, is refused as such.
    signedIn.mockResolvedValue(ADMIN);
    isAdmin.mockResolvedValue(true);
    await expect(api().admin.markets.get({ id: 'not-an-id' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(createMarket).not.toHaveBeenCalled();
  });

  it("don't exist on production, until launch, for anyone: admins included", async () => {
    vi.stubEnv('VERCEL_TARGET_ENV', 'production');
    signedIn.mockResolvedValue(ADMIN);
    isAdmin.mockResolvedValue(true);
    await expect(api().admin.markets.get({ id: consoleMarketWithLog.id })).rejects.toMatchObject(
      noSuchCall,
    );
    expect(isAdmin).not.toHaveBeenCalled();
  });
});

describe("the console's refusals", () => {
  it("become the API's answers", () => {
    const cases: [ConsoleError, { code: string; status: number }][] = [
      [
        new ConsoleError('not_admin', 'Only an admin may do this'),
        { code: 'NOT_FOUND', status: 404 },
      ],
      [new ConsoleError('not_found', 'No such market'), { code: 'NOT_FOUND', status: 404 }],
      [new ConsoleError('conflict', 'Only a draft opens'), { code: 'CONFLICT', status: 409 }],
      [
        new ConsoleError('invalid', 'A market closes in the future'),
        { code: 'BAD_REQUEST', status: 400 },
      ],
    ];
    for (const [refusal, answer] of cases) {
      const mapped = toApiError(refusal);
      expect(mapped).toBeInstanceOf(ORPCError);
      expect(mapped, refusal.kind).toMatchObject(answer);
    }
    expect(toApiError(new ConsoleError('not_admin', 'x'))).toMatchObject(noSuchCall);
    expect(toApiError(new ConsoleError('conflict', 'Only a draft opens'))).toMatchObject({
      message: 'Only a draft opens',
    });
  });

  it('a busy database says to try again, and anything else stays as it was', () => {
    expect(toApiError(new DatabaseBusyError())).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      status: 503,
    });
    const fault = new Error('a fault');
    expect(toApiError(fault)).toBe(fault);
  });
});
