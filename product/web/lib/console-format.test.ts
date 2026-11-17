import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dollars,
  indiaTime,
  indiaTimeToUtc,
  money,
  percent,
  percentToDecimal,
  ruleValue,
  utcToIndiaField,
} from './console-format.ts';

describe("the perp's console", () => {
  it('shows prices in US dollars, to the cent, exactly', () => {
    expect(dollars('100000')).toBe('$100,000.00');
    expect(dollars('101234.56')).toBe('$101,234.56');
    expect(dollars('89.5')).toBe('$89.50');
  });

  it("names the off switch's positions in its log", () => {
    expect(ruleValue('trading_mode', 'halted')).toBe('Off (halted)');
    expect(ruleValue('trading_mode', 'reduce-only')).toBe('Closing only');
    expect(ruleValue('max_leverage', '10')).toBe('10');
    expect(ruleValue('max_leverage', null)).toBe('none');
  });
});

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

// The browser's own locale formatting, as the console used it before these figures were written by
// plain arithmetic: the reference every formatter's output is compared with, to the character.
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const referenceTime = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

function referenceMoney(decimal: string): string {
  const negative = decimal.startsWith('-');
  const [whole = '0', fraction = ''] = decimal.replace(/^-/, '').split('.');
  const grouped = BigInt(whole).toLocaleString('en-IN');
  const rest = fraction.replace(/0+$/, '');
  return `${negative ? '−' : ''}Ṁ${grouped}${rest ? `.${rest}` : ''}`;
}

function referenceDollars(decimal: string): string {
  const negative = decimal.startsWith('-');
  const [whole = '0', fraction = ''] = decimal.replace(/^-/, '').split('.');
  const grouped = BigInt(whole).toLocaleString('en-US');
  return `${negative ? '-' : ''}$${grouped}.${fraction.padEnd(2, '0')}`;
}

/** A random decimal text: 1 to 30 digits, sometimes with a fraction, sometimes with a leading minus. */
function randomDecimal(random: () => number): string {
  const digits = (count: number) =>
    Array.from({ length: count }, () => Math.floor(random() * 10)).join('');
  const whole = digits(1 + Math.floor(random() * 30));
  const fraction = random() < 0.5 ? `.${digits(1 + Math.floor(random() * 8))}` : '';
  return `${random() < 0.3 ? '-' : ''}${whole}${fraction}`;
}

describe("the console's figures", () => {
  afterEach(() => vi.restoreAllMocks());

  it("use none of the browser's locale formatting: not when the module loads, not when a figure is shown", async () => {
    vi.resetModules();
    const spies = [
      vi.spyOn(Intl, 'DateTimeFormat'),
      vi.spyOn(Intl, 'NumberFormat'),
      vi.spyOn(Number.prototype, 'toLocaleString'),
      vi.spyOn(BigInt.prototype, 'toLocaleString'),
      vi.spyOn(Date.prototype, 'toLocaleString'),
      vi.spyOn(Date.prototype, 'toLocaleDateString'),
      vi.spyOn(Date.prototype, 'toLocaleTimeString'),
    ];
    const fresh = await import('./console-format.ts');
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(fresh.indiaTime('2026-11-10T12:30:00Z')).toMatch(/^10 Nov 2026, 6:00\s?pm IST$/i);
    expect(fresh.indiaTime('2026-11-10T12:30:00Z')).toBe(fresh.indiaTime('2026-11-10T12:30:00Z'));
    expect(fresh.money('1234567.5')).toBe('Ṁ12,34,567.5');
    expect(fresh.dollars('101234.56')).toBe('$101,234.56');
    expect(fresh.percent('0.5')).toBe('50%');
    expect(fresh.percentToDecimal('12.5')).toBe('0.125');
    expect(fresh.indiaTimeToUtc('2026-11-10T18:00')).toBe('2026-11-10T12:30:00.000Z');
    expect(fresh.utcToIndiaField(new Date('2026-11-10T12:30:00Z'))).toBe('2026-11-10T18:00');
    expect(fresh.ruleValue('trading_mode', 'halted')).toBe('Off (halted)');
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

describe('India time, written by plain arithmetic', () => {
  it.each([
    ['2026-11-10T12:30:00Z', '10 Nov 2026, 6:00 pm IST'],
    ['2026-01-01T18:30:00Z', '2 Jan 2026, 12:00 am IST'],
    ['2026-01-01T06:29:59Z', '1 Jan 2026, 11:59 am IST'],
    ['2026-01-01T06:30:00Z', '1 Jan 2026, 12:00 pm IST'],
    ['2026-12-31T18:29:00Z', '31 Dec 2026, 11:59 pm IST'],
    ['2026-03-09T03:35:00Z', '9 Mar 2026, 9:05 am IST'],
    ['2026-09-05T06:30:00Z', '5 Sept 2026, 12:00 pm IST'],
  ])('writes %s as %s, with plain spaces', (utc, shown) => {
    expect(indiaTime(utc)).toBe(shown);
  });

  it('refuses text that is not a time, as the browser did', () => {
    expect(() => indiaTime('not a time')).toThrow(RangeError);
    expect(() => indiaTime('')).toThrow(RangeError);
  });

  it("is what the browser's own formatting writes, for 5,000 instants from 1970 to 2199", () => {
    const random = seeded(20261118);
    const from = Date.UTC(1970, 0, 1);
    const to = Date.UTC(2199, 11, 31);
    for (let i = 0; i < 5000; i++) {
      const moment = new Date(from + Math.floor(random() * (to - from)));
      expect(indiaTime(moment.toISOString())).toBe(`${referenceTime.format(moment)} IST`);
    }
  });

  it("is what the browser's own formatting writes, every minute around midnight and noon in India", () => {
    for (const day of ['2026-01-01', '2026-02-28', '2026-09-05', '2026-12-31', '2028-02-29']) {
      for (const hour of ['18', '06']) {
        for (let minute = 28; minute <= 32; minute++) {
          for (const seconds of ['00', '30', '59']) {
            const iso = `${day}T${hour}:${minute}:${seconds}Z`;
            expect(indiaTime(iso)).toBe(`${referenceTime.format(new Date(iso))} IST`);
          }
        }
      }
    }
  });
});

describe('play money and prices, grouped by plain arithmetic', () => {
  it('keep the strings the console showed before', () => {
    expect(money('0')).toBe('Ṁ0');
    expect(money('999')).toBe('Ṁ999');
    expect(money('1000')).toBe('Ṁ1,000');
    expect(money('100000')).toBe('Ṁ1,00,000');
    expect(money('1234567')).toBe('Ṁ12,34,567');
    expect(money('1234567890')).toBe('Ṁ1,23,45,67,890');
    expect(money('1234567890123')).toBe('Ṁ12,34,56,78,90,123');
    expect(money('123456789012345678901234567890')).toBe(
      'Ṁ1,23,45,67,89,01,23,45,67,89,01,23,45,67,890',
    );
    expect(money('-1234567.5')).toBe('−Ṁ12,34,567.5');
    expect(dollars('0')).toBe('$0.00');
    expect(dollars('999')).toBe('$999.00');
    expect(dollars('1000')).toBe('$1,000.00');
    expect(dollars('1234567890')).toBe('$1,234,567,890.00');
    expect(dollars('1234567')).toBe('$1,234,567.00');
    expect(dollars('1234567890123.5')).toBe('$1,234,567,890,123.50');
    expect(dollars('-1000')).toBe('-$1,000.00');
  });

  it("are what the browser's own formatting writes, for 2,000 random amounts", () => {
    const random = seeded(7);
    for (let i = 0; i < 2000; i++) {
      const decimal = randomDecimal(random);
      expect(money(decimal)).toBe(referenceMoney(decimal));
      expect(dollars(decimal)).toBe(referenceDollars(decimal));
    }
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
