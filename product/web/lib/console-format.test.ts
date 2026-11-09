import { describe, expect, it } from 'vitest';
import {
  indiaTime,
  indiaTimeToUtc,
  money,
  percent,
  percentToDecimal,
  utcToIndiaField,
} from './console-format.ts';

describe('times in the market console', () => {
  it('are typed in India time and kept in UTC', () => {
    expect(indiaTimeToUtc('2026-11-10T18:00')).toBe('2026-11-10T12:30:00.000Z');
    expect(indiaTimeToUtc('2026-11-10T03:00')).toBe('2026-11-09T21:30:00.000Z');
    expect(indiaTimeToUtc('2026-11-10')).toBeNull();
    expect(indiaTimeToUtc('not a time')).toBeNull();
  });

  it('are shown in India time, and fill the fields the same way', () => {
    expect(indiaTime('2026-11-10T12:30:00Z')).toMatch(/^10 Nov 2026, 6:00\s?pm IST$/i);
    expect(utcToIndiaField(new Date('2026-11-10T12:30:00Z'))).toBe('2026-11-10T18:00');
  });
});

describe('play money and probabilities', () => {
  it('are shown exactly, with no rounding', () => {
    expect(money('1000.000000')).toBe('Ṁ1,000');
    expect(money('190.909090')).toBe('Ṁ190.90909');
    expect(money('-12.500000')).toBe('−Ṁ12.5');
    expect(money('100000.000001')).toBe('Ṁ1,00,000.000001');
    expect(percent('0.50000000')).toBe('50%');
    expect(percent('0.12345678')).toBe('12.345678%');
    expect(percent('0.07')).toBe('7%');
  });

  it('are typed as a percentage, 1 to 99', () => {
    expect(percentToDecimal('50')).toBe('0.5');
    expect(percentToDecimal('5')).toBe('0.05');
    expect(percentToDecimal('12.5')).toBe('0.125');
    expect(percentToDecimal('99')).toBe('0.99');
    expect(percentToDecimal('0')).toBeNull();
    expect(percentToDecimal('100')).toBeNull();
    expect(percentToDecimal('half')).toBeNull();
  });
});
