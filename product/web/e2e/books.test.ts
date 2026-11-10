import { describe, expect, it } from 'vitest';
import { decimal, micros, payout } from './support/books.ts';

/**
 * The trading journeys' own arithmetic (support/books.ts), which their check that a market's books
 * add up relies on: exact millionths, and what settlement pays each person, as the books' own
 * settlement does it (markets.settle, infra/supabase/migrations/*_markets_books.sql).
 */

describe('exact amounts', () => {
  it('read and write millionths exactly, below zero too', () => {
    for (const text of ['0.000000', '1000.000000', '989.123456', '-4.430001', '0.000001']) {
      expect(decimal(micros(text))).toBe(text);
    }
    expect(micros('12.5')).toBe(12_500_000n);
    expect(decimal(1n)).toBe('0.000001');
    expect(decimal(-1n)).toBe('-0.000001');
  });
});

describe('what a settlement pays one person', () => {
  const held = { yes: micros('97.619047'), no: micros('12.000001') };

  it('Ṁ1 a winning share, Yes or No', () => {
    expect(payout({ outcome: 'yes' }, held, 0n)).toBe(held.yes);
    expect(payout({ outcome: 'no' }, held, 0n)).toBe(held.no);
  });

  it('at a set probability: each Yes share its part, each No share the rest, rounded down once', () => {
    // 0.3 × 97.619047 + 0.7 × 12.000001 = 29.2857141 + 8.4000007 = 37.6857148, rounded down.
    expect(decimal(payout({ outcome: 'probability', probability: '0.3' }, held, 0n))).toBe(
      '37.685714',
    );
    // Eight places, the most a probability has: still exact before the one rounding.
    const one = { yes: 1_000_000n, no: 0n };
    expect(decimal(payout({ outcome: 'probability', probability: '0.12345678' }, one, 0n))).toBe(
      '0.123456',
    );
    expect(payout({ outcome: 'probability', probability: '1' }, held, 0n)).toBe(held.yes);
    expect(payout({ outcome: 'probability', probability: '0' }, held, 0n)).toBe(held.no);
  });

  it('a cancel gives back what they put in less what they took out, below zero after a profit', () => {
    expect(payout({ outcome: 'cancel', reason: 'r' }, held, micros('50'))).toBe(micros('50'));
    expect(decimal(payout({ outcome: 'cancel', reason: 'r' }, held, micros('-4.43')))).toBe(
      '-4.430000',
    );
  });
});
