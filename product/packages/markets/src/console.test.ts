import { DatabaseBusyError } from '@hrizzup/db';
import { describe, expect, it } from 'vitest';
import { asConsoleError, ConsoleError, createMarket, getMarket, settleMarket } from './console.ts';

/**
 * Quick checks, with no database: the database's refusals become the console's own, and each call
 * sends the database's function what it asked for and reads its answer back in the contract's
 * shape. The calls against a real database are in console.db.test.ts (the Database check).
 */

/** A database error as pg gives one: its SQLSTATE code, message and constraint. */
function refusal(code: string, message: string, constraint?: string) {
  return Object.assign(new Error(message), { code, ...(constraint ? { constraint } : {}) });
}

describe("the database's refusals", () => {
  it("become the console's own, by kind", () => {
    const cases: [string, ConsoleError['kind']][] = [
      ['42501', 'not_admin'],
      ['P0002', 'not_found'],
      ['55000', 'conflict'],
      ['0A000', 'conflict'],
      ['22023', 'invalid'],
      ['23514', 'invalid'],
      ['23505', 'invalid'],
    ];
    for (const [code, kind] of cases) {
      const mapped = asConsoleError(refusal(code, `refused (${code})`));
      expect(mapped, code).toBeInstanceOf(ConsoleError);
      expect((mapped as ConsoleError).kind, code).toBe(kind);
    }
  });

  it("never say more than 'only an admin' to someone who isn't one", () => {
    const mapped = asConsoleError(refusal('42501', 'permission denied for schema private'));
    expect((mapped as ConsoleError).message).toBe('Only an admin may do this');
  });

  it("put a rule of the agreement's building blocks in plain words", () => {
    const mapped = asConsoleError(
      refusal(
        '23514',
        'value for domain agreement.one_line violates check constraint',
        'one_line_code_checks',
      ),
    );
    expect((mapped as ConsoleError).message).toBe('Must be plain text, with no hidden characters');
  });

  it('leave anything else as it was: a busy database, or a fault', () => {
    const busy = new DatabaseBusyError();
    expect(asConsoleError(busy)).toBe(busy);
    const fault = refusal('XX000', 'internal error');
    expect(asConsoleError(fault)).toBe(fault);
  });
});

/** A pool whose one connection records what it's sent, and answers a console call with `row`. */
function fakePool(row: unknown) {
  const sent: { text: string; values?: unknown[] }[] = [];
  const client = {
    async query(text: string, values?: unknown[]) {
      sent.push({ text, ...(values ? { values } : {}) });
      return { rows: text.includes(' as answer') ? [{ answer: row }] : [] };
    },
    release() {},
  };
  return { sent, pool: { connect: async () => client } as never };
}

const row = {
  id: '019a6b3c-0001-7000-8000-000000000001',
  question: 'Will test event A happen?',
  categories: ['general'],
  kind: 'yes_no',
  rules: 'Rules.',
  source: { name: "Hrizzup's test desk" },
  settlement: 'by_hand',
  opens_at: '2026-11-09T15:00:00Z',
  closes_at: '2026-11-10T15:00:00Z',
  state: 'settled',
  resolution: 'MKT',
  resolution_probability: '0.70000000',
  cancel_reason: null,
  settled_at: '2026-11-10T16:00:00.25Z',
  created_at: '2026-11-09T14:00:00Z',
  updated_at: '2026-11-10T16:00:00.25Z',
  created_by: { id: '00000000-0000-4000-8000-0000000000c1', email: 'ada@console.test' },
  starting_probability: '0.50000000',
  seed: '1000.000000',
  pool: { yes: '1000.000000', no: '1000.000000' },
  probability: null,
  held: '0.000000',
  trades: 3,
  log: [
    {
      id: 7,
      action: 'settle',
      at: '2026-11-10T16:00:00.25Z',
      by: { id: '00000000-0000-4000-8000-0000000000c1', email: null },
      outcome: 'probability',
      probability: '0.70000000',
      evidence: 'The rules settle a partial event at 70%.',
      reason: null,
      paid_to_people: '140.000000',
      people: 2,
      to_house: '860.000000',
    },
  ],
};

describe('a call', () => {
  it("runs as the signed-in admin and reads the answer in the contract's shape", async () => {
    const { sent, pool } = fakePool(row);
    const market = await getMarket(pool, '00000000-0000-4000-8000-0000000000c1', row.id);
    expect(sent.map((s) => s.text)).toEqual([
      'begin',
      expect.stringContaining("set_config('role', $1, true)"),
      'select admin.market($1) as answer',
      'commit',
    ]);
    expect(sent[1]?.values?.[2]).toBe('00000000-0000-4000-8000-0000000000c1');
    expect(market).toMatchObject({
      opensAt: '2026-11-09T15:00:00Z',
      state: 'settled',
      result: {
        outcome: 'probability',
        probability: '0.70000000',
        cancelReason: null,
        at: '2026-11-10T16:00:00.25Z',
      },
      createdBy: { email: 'ada@console.test' },
      log: [
        {
          action: 'settle',
          by: { email: null },
          settlement: {
            outcome: 'probability',
            paidToPeople: '140.000000',
            people: 2,
            toHouse: '860.000000',
          },
        },
      ],
    });
  });

  it("sends a market with no source address as null, and a settlement's missing parts as null", async () => {
    const created = fakePool(row);
    await createMarket(created.pool, '00000000-0000-4000-8000-0000000000c1', {
      id: row.id,
      question: row.question,
      categories: ['general'],
      rules: 'Rules.',
      source: { name: 'Desk' },
      opensAt: '2026-11-09T15:00:00Z',
      closesAt: '2026-11-10T15:00:00Z',
      probability: '0.5',
      seed: '1000',
    });
    expect(created.sent[2]?.values).toEqual([
      row.id,
      row.question,
      ['general'],
      'Rules.',
      'Desk',
      null,
      '2026-11-09T15:00:00Z',
      '2026-11-10T15:00:00Z',
      '0.5',
      '1000',
    ]);
    const settled = fakePool(row);
    await settleMarket(settled.pool, '00000000-0000-4000-8000-0000000000c1', {
      id: row.id,
      outcome: 'yes',
      evidence: 'What the test desk recorded.',
    });
    expect(settled.sent[2]?.values).toEqual([
      row.id,
      'yes',
      null,
      'What the test desk recorded.',
      null,
    ]);
  });
});
