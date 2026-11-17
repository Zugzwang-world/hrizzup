import { describe, expect, it } from 'vitest';
import { groupIndian, groupWestern, roundedDigits } from './digits.ts';

describe('digits grouped the Indian way (the last three, then pairs)', () => {
  it.each([
    ['0', '0'],
    ['999', '999'],
    ['1000', '1,000'],
    ['100000', '1,00,000'],
    ['1234567', '12,34,567'],
    ['1234567890', '1,23,45,67,890'],
    ['1234567890123', '12,34,56,78,90,123'],
    ['123456789012345678901234567890', '1,23,45,67,89,01,23,45,67,89,01,23,45,67,890'],
  ])('writes %s as %s', (digits, grouped) => {
    expect(groupIndian(digits)).toBe(grouped);
  });
});

describe('digits grouped in threes', () => {
  it.each([
    ['0', '0'],
    ['999', '999'],
    ['1000', '1,000'],
    ['100000', '100,000'],
    ['1234567', '1,234,567'],
    ['1234567890', '1,234,567,890'],
    ['1234567890123', '1,234,567,890,123'],
  ])('writes %s as %s', (digits, grouped) => {
    expect(groupWestern(digits)).toBe(grouped);
  });
});

describe('a number rounded to a number of decimals, half away from zero', () => {
  it('rounds on the shortest decimal form, never on the stored binary value', () => {
    // 2.675 is stored as 2.67499999..., and `toFixed(2)` gives 2.67; people read 2.68.
    expect(roundedDigits(2.675, 2)).toEqual({ negative: false, whole: '2', fraction: '68' });
    expect(roundedDigits(1.005, 2)).toEqual({ negative: false, whole: '1', fraction: '01' });
    expect(roundedDigits(0.125, 2)).toEqual({ negative: false, whole: '0', fraction: '13' });
    expect(roundedDigits(0.0049, 2)).toEqual({ negative: false, whole: '0', fraction: '00' });
    expect(roundedDigits(0.1 + 0.2, 2)).toEqual({ negative: false, whole: '0', fraction: '30' });
  });

  it('carries through the fraction and then the whole part', () => {
    expect(roundedDigits(99.995, 2)).toEqual({ negative: false, whole: '100', fraction: '00' });
    expect(roundedDigits(0.995, 2)).toEqual({ negative: false, whole: '1', fraction: '00' });
    expect(roundedDigits(9.995, 2)).toEqual({ negative: false, whole: '10', fraction: '00' });
    expect(roundedDigits(0.9949, 2)).toEqual({ negative: false, whole: '0', fraction: '99' });
    expect(roundedDigits(123456789.995, 2)).toEqual({
      negative: false,
      whole: '123456790',
      fraction: '00',
    });
  });

  it('leaves a short fraction short, for the caller to pad or trim', () => {
    expect(roundedDigits(0.5, 2)).toEqual({ negative: false, whole: '0', fraction: '5' });
    expect(roundedDigits(74250, 2)).toEqual({ negative: false, whole: '74250', fraction: '' });
    expect(roundedDigits(74250.12, 2)).toEqual({ negative: false, whole: '74250', fraction: '12' });
  });

  it('keeps the minus, even on a minus zero and on a negative that rounds to zero', () => {
    expect(roundedDigits(-1.5, 2)).toEqual({ negative: true, whole: '1', fraction: '5' });
    expect(roundedDigits(-0, 2)).toEqual({ negative: true, whole: '0', fraction: '' });
    expect(roundedDigits(0, 2)).toEqual({ negative: false, whole: '0', fraction: '' });
    expect(roundedDigits(-0.001, 2)).toEqual({ negative: true, whole: '0', fraction: '00' });
  });

  it('expands the exponent forms String() gives (from 1e21 up, and below 1e-6)', () => {
    expect(String(1e21)).toBe('1e+21');
    expect(roundedDigits(1e21, 2)).toEqual({
      negative: false,
      whole: '1000000000000000000000',
      fraction: '',
    });
    expect(roundedDigits(-1e21, 2).whole).toBe('1000000000000000000000');
    expect(roundedDigits(1.5e22, 2).whole).toBe('15000000000000000000000');
    expect(String(1.5e-7)).toBe('1.5e-7');
    expect(roundedDigits(1.5e-7, 2)).toEqual({ negative: false, whole: '0', fraction: '00' });
    expect(roundedDigits(1e-7, 2)).toEqual({ negative: false, whole: '0', fraction: '00' });
    expect(String(5e-324)).toBe('5e-324');
    expect(roundedDigits(5e-324, 2)).toEqual({ negative: false, whole: '0', fraction: '00' });
    expect(roundedDigits(1.23e-18, 2)).toEqual({ negative: false, whole: '0', fraction: '00' });
    // A tiny figure that does round up once the places are few enough.
    expect(roundedDigits(5e-7, 6)).toEqual({ negative: false, whole: '0', fraction: '000001' });
    expect(roundedDigits(4e-7, 6)).toEqual({ negative: false, whole: '0', fraction: '000000' });
  });

  it('handles the biggest numbers without losing a digit', () => {
    expect(roundedDigits(Number.MAX_VALUE, 2).whole).toHaveLength(309);
    expect(roundedDigits(1e15, 2)).toEqual({
      negative: false,
      whole: '1000000000000000',
      fraction: '',
    });
  });
});
