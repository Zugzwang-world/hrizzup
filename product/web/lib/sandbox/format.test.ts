import { afterEach, describe, expect, it, vi } from 'vitest';
import { money } from '../console-format.ts';
import {
  cents,
  chance,
  change,
  justAbove,
  lineOf,
  liquidationAbout,
  mostMargin,
  noCents,
  plain,
  plainAmount,
  ratePercent,
  roughMoney,
  shareOf,
  short,
  signed,
  times,
  typedAmount,
  typedPercent,
  usd,
  yesCents,
} from './format.ts';

describe('chances and prices', () => {
  it('round a probability to whole cents, half up, by whole numbers', () => {
    expect(cents('0.4812')).toBe(48);
    expect(cents('0.485')).toBe(49);
    expect(cents('0.48499999')).toBe(48);
    expect(cents('0.5')).toBe(50);
    expect(cents('0.01')).toBe(1);
    expect(cents('0.99')).toBe(99);
    expect(cents('0.123456789')).toBe(12);
    expect(chance('0.4812')).toBe('48%');
  });

  it('price Yes at the chance and No at the rest of a dollar, always summing to 100', () => {
    for (const probability of ['0.01', '0.2', '0.4812', '0.5', '0.505', '0.99']) {
      expect(yesCents(probability) + noCents(probability)).toBe(100);
    }
    expect(yesCents('0.4812')).toBe(48);
    expect(noCents('0.4812')).toBe(52);
  });
});

describe('finding one market through the list', () => {
  const id = '019a6c00-0000-7000-8000-000000000003';

  it('asks for the page after the ID just above the market (the list is newest first, after = smaller)', () => {
    expect(justAbove(id)).toBe('019a6c00-0000-7000-8000-000000000004');
    expect(justAbove('019a6c00-0000-7000-8000-00000000000f')).toBe(
      '019a6c00-0000-7000-8000-000000000010',
    );
    expect(justAbove('019a6c00-0000-7000-8000-ffffffffffff')).toBe(
      '019a6c00-0000-7000-8001-000000000000',
    );
  });

  it('is above the market, and below any other that is above the market', () => {
    const above = justAbove(id) as string;
    expect(above > id).toBe(true);
    // Nothing fits between a market and the ID just above it.
    expect(BigInt(`0x${above.replaceAll('-', '')}`) - BigInt(`0x${id.replaceAll('-', '')}`)).toBe(
      1n,
    );
  });

  it("gives nothing when the sum would no longer be a market's ID, or for what isn't one", () => {
    expect(justAbove('019a6c00-0000-7000-bfff-ffffffffffff')).toBeNull();
    expect(justAbove('nonsense')).toBeNull();
    expect(justAbove('019a6c00-0000-4000-8000-000000000003')).toBeNull();
  });
});

describe('amounts typed and shown', () => {
  it('read what people type', () => {
    expect(typedAmount(' Ṁ1,250.5 ')).toBe('1250.5');
    expect(typedPercent(' 45.5% ')).toBe('45.5');
  });

  it('write amounts to six decimals at most, cut and never rounded up', () => {
    expect(plainAmount(990.0990099)).toBe('990.099009');
    expect(plainAmount(25)).toBe('25');
    expect(plainAmount(0)).toBe('');
    expect(plainAmount(Number.NaN)).toBe('');
  });

  it('take a share of the balance, never more than the cap', () => {
    expect(shareOf('1000', 25)).toBe('250');
    expect(shareOf('1000', 50, 400)).toBe('400');
  });

  it('keep exact decimals as text, cut at the places asked for', () => {
    expect(plain('1234567.8901234')).toBe('12,34,567.890123');
    expect(plain('0.500000')).toBe('0.5');
    expect(plain('-12.5')).toBe('−12.5');
    expect(short('990.099009901')).toBe('Ṁ990.099');
    expect(short('-12.5')).toBe('−Ṁ12.5');
    expect(short('0')).toBe('Ṁ0');
  });

  it('sign a profit or a loss', () => {
    expect(signed('12.5', short)).toBe('+Ṁ12.5');
    expect(signed('-3', short)).toBe('−Ṁ3');
    expect(signed('0', short)).toBe('Ṁ0');
    expect(signed('0.000', money)).toBe('Ṁ0');
  });
});

describe("a perp's figures", () => {
  it("find where a position is liquidated, as the engine's maths does: entry moved by 1 / leverage", () => {
    expect(liquidationAbout('long', 100, 4)).toBe(75);
    expect(liquidationAbout('short', 100, 4)).toBe(125);
    expect(liquidationAbout('long', 100, 1)).toBe(0);
    expect(liquidationAbout('short', 100, 1)).toBe(200);
  });

  it('leave room for the opening fee when asked for the most margin', () => {
    // 10 basis points of a 10x position is 1% of the margin on top of it.
    const most = mostMargin('1000', 10, '10');
    expect(most).toBeLessThan(1000 / 1.01);
    expect(most).toBeGreaterThan(990.09);
    expect(mostMargin('0', 10, '10')).toBe(0);
  });

  it('write a funding rate as a percentage', () => {
    expect(ratePercent('0.0002')).toBe('0.02%');
    expect(ratePercent('0')).toBe('0.0%');
    expect(ratePercent('-0.0001')).toBe('-0.01%');
  });

  it('write a change in the price with its sign', () => {
    expect(change(100, 101.5)).toBe('+$1.50 (+1.50%)');
    expect(change(100, 98)).toBe('−$2.00 (−2.00%)');
    expect(change(100, 100)).toBe('$0.00 (0.00%)');
  });

  it('write a multiplier', () => {
    expect(times(3)).toBe('3x');
    expect(times('3.9')).toBe('3.9x');
    expect(times('10.0000')).toBe('10x');
  });
});

// The browser's own locale formatting, as the perp's figures used it before they were written by
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

const referenceDollar = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function referenceUsd(price: number | string): string {
  const value = Number(price);
  return Number.isFinite(value) ? referenceDollar.format(value) : '–';
}

function referenceChange(from: number, to: number): string {
  const delta = to - from;
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  const percent = from === 0 ? 0 : (Math.abs(delta) / from) * 100;
  return `${sign}${referenceDollar.format(Math.abs(delta))} (${sign}${percent.toFixed(2)}%)`;
}

function referenceRough(value: number): string {
  return `Ṁ${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function referencePlain(decimal: string, places = 6): string {
  const negative = decimal.startsWith('-');
  const [whole = '0', fraction = ''] = decimal.replace(/^-/, '').split('.');
  const grouped = BigInt(whole).toLocaleString('en-IN');
  const rest = fraction.slice(0, places).replace(/0+$/, '');
  return `${negative ? '−' : ''}${grouped}${rest ? `.${rest}` : ''}`;
}

/** 20,000 figures: every magnitude from 1e-9 to 1e15 with either sign, decimals, exact halves and the odd ones. */
function figures(): number[] {
  const random = seeded(20261118);
  const digits = (count: number) =>
    Array.from({ length: count }, () => Math.floor(random() * 10)).join('');
  const values: number[] = [0, -0, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (let i = 0; i < 8000; i++) {
    values.push((random() < 0.5 ? -1 : 1) * 10 ** (-9 + 24 * random()));
  }
  for (let i = 0; i < 5995; i++) {
    const whole = String(Math.floor(random() ** 3 * 10 ** (1 + Math.floor(random() * 9))));
    values.push(
      Number(`${random() < 0.5 ? '-' : ''}${whole}.${digits(1 + Math.floor(random() * 6))}`),
    );
  }
  for (let i = 0; i < 2000; i++) {
    // An exact half of a cent, and its two neighbours: x.xx4, x.xx5, x.xx6.
    const base = `${Math.floor(random() ** 3 * 10 ** (1 + Math.floor(random() * 9)))}.${digits(2)}`;
    const sign = random() < 0.5 ? '-' : '';
    for (const last of ['4', '5', '6']) values.push(Number(`${sign}${base}${last}`));
  }
  while (values.length < 20_000) {
    values.push(random() * 1000 - 500);
  }
  return values;
}

describe("a perp's dollar figures", () => {
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
    const fresh = await import('./format.ts');
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(fresh.usd(74250.123)).toBe('$74,250.12');
    expect(fresh.change(100, 101.5)).toBe('+$1.50 (+1.50%)');
    expect(fresh.usd('x')).toBe('–');
    expect(fresh.roughMoney(12345.678)).toBe('Ṁ12,345.68');
    expect(fresh.plain('1234567.8901234')).toBe('12,34,567.890123');
    expect(fresh.short('990.099009901')).toBe('Ṁ990.099');
    expect(fresh.signed('12.5', fresh.short)).toBe('+Ṁ12.5');
    expect(fresh.times('3.9')).toBe('3.9x');
    expect(fresh.ratePercent('0.0002')).toBe('0.02%');
    expect(fresh.liquidationAbout('long', 100, 4)).toBe(75);
    expect(fresh.shareOf('1000', 25)).toBe('250');
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    [0, '$0.00'],
    [-0, '-$0.00'],
    [1.005, '$1.01'],
    [2.675, '$2.68'],
    [0.125, '$0.13'],
    [0.005, '$0.01'],
    [0.0049, '$0.00'],
    [0.995, '$1.00'],
    [9.995, '$10.00'],
    [74250.12, '$74,250.12'],
    [74250.125, '$74,250.13'],
    [101234.565, '$101,234.57'],
    [-1.5, '-$1.50'],
    [-0.001, '-$0.00'],
    [1e15, '$1,000,000,000,000,000.00'],
    [123456789.995, '$123,456,790.00'],
    [0.1 + 0.2, '$0.30'],
    [1e-7, '$0.00'],
    [5e-324, '$0.00'],
  ])('writes the price %s as %s', (price, shown) => {
    expect(usd(price)).toBe(shown);
  });

  it('writes a price that is not a number as a dash', () => {
    expect(usd('x')).toBe('–');
    expect(usd(Number.NaN)).toBe('–');
    expect(usd(Number.POSITIVE_INFINITY)).toBe('–');
    expect(usd('74250.5')).toBe('$74,250.50');
  });

  it("writes a change's amount as the price is written, the odd ones included", () => {
    expect(change(0, 1.5)).toBe('+$1.50 (+0.00%)');
    expect(change(0, 0.005)).toBe('+$0.01 (+0.00%)');
    expect(change(0, 0.0049)).toBe('+$0.00 (+0.00%)');
    expect(change(Number.NaN, 1)).toContain('$NaN');
    expect(change(0, Number.POSITIVE_INFINITY)).toBe('+$∞ (+0.00%)');
  });

  it("is what the browser's own formatting writes, for 20,000 figures, in usd and in change", () => {
    const values = figures();
    expect(values).toHaveLength(20_000);
    for (const [i, value] of values.entries()) {
      expect(usd(value)).toBe(referenceUsd(value));
      expect(usd(String(value))).toBe(referenceUsd(String(value)));
      const from = values[(i * 7 + 3) % values.length] as number;
      expect(change(from, value)).toBe(referenceChange(from, value));
      expect(change(value, from)).toBe(referenceChange(value, from));
      // A change from a price a little way off: the amounts that round at the half cent.
      expect(change(value, value + 0.005)).toBe(referenceChange(value, value + 0.005));
    }
  });
});

describe("a perp's rough play money", () => {
  it.each([
    [0, 'Ṁ0'],
    [-0, 'Ṁ-0'],
    [0.5, 'Ṁ0.5'],
    [12345.678, 'Ṁ12,345.68'],
    [12345.675, 'Ṁ12,345.68'],
    [-1234.5, 'Ṁ-1,234.5'],
    [1.005, 'Ṁ1.01'],
    [0.995, 'Ṁ1'],
    [-0.995, 'Ṁ-1'],
    [99999.995, 'Ṁ1,00,000'],
    [100000, 'Ṁ1,00,000'],
    [1e21, 'Ṁ1,00,00,00,00,00,00,00,00,00,000'],
    [-1e21, 'Ṁ-1,00,00,00,00,00,00,00,00,00,000'],
    [1e-7, 'Ṁ0'],
    [-0.001, 'Ṁ-0'],
    [Number.NaN, 'ṀNaN'],
    [Number.POSITIVE_INFINITY, 'Ṁ∞'],
    [Number.NEGATIVE_INFINITY, 'Ṁ-∞'],
  ])('writes %s as %s', (value, shown) => {
    expect(roughMoney(value)).toBe(shown);
  });

  it("is what the browser's own formatting writes, for 20,000 figures", () => {
    for (const value of figures()) expect(roughMoney(value)).toBe(referenceRough(value));
  });
});

describe('exact decimals grouped by plain arithmetic', () => {
  it("are what the browser's own formatting writes, for 2,000 random amounts", () => {
    const random = seeded(11);
    const digits = (count: number) =>
      Array.from({ length: count }, () => Math.floor(random() * 10)).join('');
    for (let i = 0; i < 2000; i++) {
      const decimal = `${random() < 0.3 ? '-' : ''}${digits(1 + Math.floor(random() * 30))}${
        random() < 0.5 ? `.${digits(1 + Math.floor(random() * 8))}` : ''
      }`;
      expect(plain(decimal)).toBe(referencePlain(decimal));
      expect(plain(decimal, 4)).toBe(referencePlain(decimal, 4));
      expect(short(decimal)).toBe(
        referencePlain(decimal, 4).startsWith('−')
          ? `−Ṁ${referencePlain(decimal, 4).slice(1)}`
          : `Ṁ${referencePlain(decimal, 4)}`,
      );
    }
  });

  it('keep the grouping table', () => {
    expect(plain('0')).toBe('0');
    expect(plain('999')).toBe('999');
    expect(plain('1000')).toBe('1,000');
    expect(plain('100000')).toBe('1,00,000');
    expect(plain('1234567890123')).toBe('12,34,56,78,90,123');
    expect(plain('123456789012345678901234567890')).toBe(
      '1,23,45,67,89,01,23,45,67,89,01,23,45,67,890',
    );
  });
});

describe('the price line', () => {
  it('draws nothing for no readings, and a flat line for one', () => {
    expect(lineOf([], 300, 80)).toBeNull();
    const one = lineOf([{ at: 1000, value: 0.5 }], 300, 80);
    expect(one?.path).toMatch(/^M0 [\d.]+ H300$/);
  });

  it('steps from reading to reading across the time since the first, scaled to the range seen', () => {
    const line = lineOf(
      [
        { at: 0, value: 0.4 },
        { at: 5000, value: 0.5 },
        { at: 10000, value: 0.45 },
      ],
      300,
      80,
    );
    expect(line?.path).toMatch(/^M0 [\d.]+ H150\.00 V[\d.]+ H300\.00 V[\d.]+$/);
    // The highest reading is drawn higher (a smaller y) than the lowest.
    const ys = [...(line?.path.matchAll(/[MV]0? ?([\d.]+)/g) ?? [])].map((m) => Number(m[1]));
    expect(ys).toHaveLength(3);
    expect(ys[1] as number).toBeLessThan(ys[0] as number);
    expect(ys[2] as number).toBeLessThan(ys[0] as number);
    expect(ys[1] as number).toBeLessThan(ys[2] as number);
  });

  it("keeps the range inside the floor and ceiling it's given, and never divides by nothing", () => {
    const line = lineOf(
      [
        { at: 0, value: 0.5 },
        { at: 10, value: 0.5 },
      ],
      300,
      80,
      0,
      1,
    );
    expect(line?.min).toBeGreaterThanOrEqual(0);
    expect(line?.max).toBeLessThanOrEqual(1);
    expect(line?.path).not.toContain('NaN');
    expect(line?.path).not.toContain('Infinity');
  });
});
