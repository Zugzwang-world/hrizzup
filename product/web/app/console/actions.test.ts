import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The market console's forms (actions.ts): to anyone but an admin, each answers "not found"
 * before it reads anything sent, so a bad input can't tell a stranger the console exists. An
 * admin's refusals come back in words, with what was typed kept. Who is an admin, and the typed
 * API's answers, are stood in for here; the calls themselves are tested with the API and the
 * database.
 */

const consoleAdmin = vi.fn();
const markets = { create: vi.fn(), open: vi.fn(), close: vi.fn(), settle: vi.fn() };

vi.mock('@/lib/console.ts', () => ({ consoleAdmin: () => consoleAdmin() }));
vi.mock('@/lib/api/server.ts', () => ({ serverApi: { admin: { markets } } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

const { closeMarketAction, createMarketAction, openMarketAction, settleMarketAction } =
  await import('./actions.ts');

const START = { error: null, values: {} };
const ID = '019a6b3c-0001-7000-8000-000000000001';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const goodMarket = {
  id: ID,
  question: 'Will test event A happen?',
  category1: 'general',
  rules: 'Yes if the test desk records it.\r\nOtherwise No.',
  sourceName: 'Test desk',
  opensDate: '2026-11-10',
  opensTime: '18:00',
  closesDate: '2026-11-17',
  closesTime: '18:00',
  probability: '50',
  seed: '1000',
};

afterEach(() => vi.clearAllMocks());

describe("the console's forms, to anyone but an admin", () => {
  it('answer "not found" before reading anything, whatever was sent', async () => {
    consoleAdmin.mockResolvedValue(null);
    const attempts: [typeof createMarketAction, FormData][] = [
      [createMarketAction, form({ probability: 'not a number', opensDate: 'never' })],
      [createMarketAction, form(goodMarket)],
      [openMarketAction, form({ id: 'not-an-id' })],
      [closeMarketAction, form({ id: ID })],
      [settleMarketAction, form({ id: ID, outcome: 'probability', probability: 'bad' })],
      [settleMarketAction, form({ id: ID, outcome: 'yes', evidence: 'Evidence.' })],
    ];
    for (const [action, sent] of attempts) {
      await expect(action(START, sent)).rejects.toThrow('NOT_FOUND');
    }
    for (const call of Object.values(markets)) expect(call).not.toHaveBeenCalled();
  });
});

describe("the console's forms, to an admin", () => {
  it('create the market as typed (times from India time, new lines as the agreement writes them), then show it', async () => {
    consoleAdmin.mockResolvedValue({ account: 'admin', pool: {} });
    markets.create.mockResolvedValue({ id: ID });
    await expect(createMarketAction(START, form(goodMarket))).rejects.toThrow(
      `REDIRECT /console/markets/${ID}`,
    );
    expect(markets.create).toHaveBeenCalledWith({
      id: ID,
      question: 'Will test event A happen?',
      categories: ['general'],
      rules: 'Yes if the test desk records it.\nOtherwise No.',
      source: { name: 'Test desk' },
      opensAt: '2026-11-10T12:30:00.000Z',
      closesAt: '2026-11-17T12:30:00.000Z',
      probability: '0.5',
      seed: '1000',
      listed: true,
    });
  });

  it('create a test market off the public list when its box is ticked', async () => {
    consoleAdmin.mockResolvedValue({ account: 'admin', pool: {} });
    markets.create.mockResolvedValue({ id: ID });
    await expect(
      createMarketAction(START, form({ ...goodMarket, unlisted: 'on' })),
    ).rejects.toThrow(`REDIRECT /console/markets/${ID}`);
    expect(markets.create).toHaveBeenCalledWith(expect.objectContaining({ listed: false }));
  });

  it("answer a bad input in words, keeping what was typed, and don't call the API", async () => {
    consoleAdmin.mockResolvedValue({ account: 'admin', pool: {} });
    const answer = await createMarketAction(START, form({ ...goodMarket, probability: '150' }));
    expect(answer.error).toBe('Probability: a percentage from 1 to 99.');
    expect(answer.values.question).toBe('Will test event A happen?');
    expect(markets.create).not.toHaveBeenCalled();
  });

  it('settle with the outcome chosen, leaving out what belongs to another outcome', async () => {
    consoleAdmin.mockResolvedValue({ account: 'admin', pool: {} });
    markets.settle.mockResolvedValue({ id: ID });
    await expect(
      settleMarketAction(
        START,
        form({
          id: ID,
          outcome: 'yes',
          evidence: 'Evidence.',
          probability: '70',
          reason: 'Unused.',
        }),
      ),
    ).rejects.toThrow(`REDIRECT /console/markets/${ID}`);
    expect(markets.settle).toHaveBeenCalledWith({ id: ID, outcome: 'yes', evidence: 'Evidence.' });
  });
});
