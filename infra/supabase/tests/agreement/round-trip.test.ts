import { shapes, validate } from '@hrizzup/agreement';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connect, transactions } from './database.ts';
import {
  examples,
  type Format,
  fieldsOf,
  HELD_ELSEWHERE,
  isStored,
  loadExamples,
  read,
  TABLES,
} from './records.ts';

/**
 * The content store holds the agreement's records exactly (PLAN.md step 1.9): every example in
 * `agreement/examples/` goes in and comes back unchanged, and still passes `validate()`.
 */

let db: pg.Client;
const tx = transactions(() => db);
beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db?.end();
});
beforeEach(() => tx.begin());
afterEach(() => tx.rollback());

describe('the content store', () => {
  it('holds every shape the agreement defines, or the step whose store will is named', () => {
    for (const format of Object.keys(shapes)) {
      expect(isStored(format) || Object.hasOwn(HELD_ELSEWHERE, format), format).toBe(true);
    }
  });

  it('has one column for each field of each shape, and nothing else', async () => {
    for (const [format, table] of Object.entries(TABLES)) {
      const { rows } = await db.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema = 'content' and table_name = $1`,
        [table],
      );
      expect(rows.map((r) => r.column_name).sort(), table).toEqual(
        fieldsOf(format as Format)
          .map((f) => f.column)
          .sort(),
      );
    }
  });

  it('loads every example and reads each back unchanged, still passing validate()', async () => {
    await loadExamples(db);
    // The rules across records hold for the examples, as they would at a commit.
    await tx.settle();

    const stored = examples.filter((e) => isStored(e.format));
    const elsewhere = examples.filter((e) => Object.hasOwn(HELD_ELSEWHERE, String(e.format)));
    expect(stored.length + elsewhere.length, 'every example is accounted for').toBe(
      examples.length,
    );
    expect(stored.length).toBeGreaterThan(0);

    for (const example of stored) {
      const back = await read(db, example.format as Format, String(example.id));
      expect(back, `${String(example.format)} ${String(example.id)}`).toStrictEqual(example);
      expect(validate(back)).toEqual([]);
    }
  });
});
