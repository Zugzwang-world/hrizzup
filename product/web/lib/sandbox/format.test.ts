import { describe, expect, it } from 'vitest';
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
  shareOf,
  short,
  signed,
  times,
  typedAmount,
  typedPercent,
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
