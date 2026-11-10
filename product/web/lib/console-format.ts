/**
 * How the market console writes and reads times, play money and probabilities. Times are typed and
 * shown in India time (the agreement keeps them in UTC; screens show them in India time), and
 * amounts stay exact: the database's decimals are only ever reformatted as text, never turned into
 * floating-point numbers.
 */

const INDIA = 'Asia/Kolkata';

const shown = new Intl.DateTimeFormat('en-IN', {
  timeZone: INDIA,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/** A moment as people read it, in India time: "10 Nov 2026, 6:00 pm IST". */
export function indiaTime(iso: string): string {
  return `${shown.format(new Date(iso))} IST`;
}

/**
 * A time typed into the console's date-and-time field (`2026-11-10T18:00`), which is India time,
 * as the moment it names, in UTC (`2026-11-10T12:30:00.000Z`). Null if it isn't one.
 */
export function indiaTimeToUtc(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const moment = new Date(`${local}:00+05:30`);
  return Number.isNaN(moment.getTime()) ? null : moment.toISOString();
}

/** A moment as the console's date-and-time field holds it, in India time (`2026-11-10T18:00`). */
export function utcToIndiaField(moment: Date): string {
  const india = new Date(moment.getTime() + 330 * 60_000);
  return india.toISOString().slice(0, 16);
}

/** Exact play money as people read it: Ṁ1,000, Ṁ190.90909, −Ṁ12.5. */
export function money(decimal: string): string {
  const negative = decimal.startsWith('-');
  const [whole = '0', fraction = ''] = decimal.replace(/^-/, '').split('.');
  const grouped = BigInt(whole).toLocaleString('en-IN');
  const rest = fraction.replace(/0+$/, '');
  return `${negative ? '−' : ''}Ṁ${grouped}${rest ? `.${rest}` : ''}`;
}

/** A probability as a percentage, exactly: 0.5 is 50%, 0.12345678 is 12.345678%. */
export function percent(decimal: string): string {
  const [whole = '0', fraction = ''] = decimal.split('.');
  const scaled = BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, '0').slice(0, 8));
  const units = scaled / 1_000_000n;
  const rest = (scaled % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${units}${rest ? `.${rest}` : ''}%`;
}

/** A percentage typed into the console (1 to 99, up to six decimals) as a probability: 50 is 0.5. */
export function percentToDecimal(typed: string): string | null {
  const match = /^(\d{1,2})(?:\.(\d{1,6}))?$/.exec(typed.trim());
  if (!match) return null;
  const decimal = `0.${(match[1] ?? '').padStart(2, '0')}${match[2] ?? ''}`.replace(/\.?0+$/, '');
  return decimal === '0' || decimal === '' ? null : decimal;
}

/** A market's state, as the console shows it. */
export const STATE_NAMES: Record<string, string> = {
  draft: 'Draft',
  open: 'Open',
  closed: 'Closed',
  settled: 'Settled',
  cancelled: 'Cancelled',
};

/** A perp's off switch, as the console shows it (Manifold's trading modes). */
export const MODE_NAMES: Record<string, string> = {
  enabled: 'On',
  'reduce-only': 'Closing only',
  halted: 'Off (halted)',
};

/** What each position of the off switch does, in words. */
export const MODE_HINTS: Record<string, string> = {
  enabled: 'Trading on: opens and closes, a new price every 5 seconds, liquidations and funding.',
  'reduce-only': 'Closing only: no new positions; closes, prices, liquidations and funding go on.',
  halted: 'Off: nothing runs at all: no trade, no new price, no liquidation and no funding.',
};

/** A US dollar price as people read it, exactly: $101,234.56. */
export function dollars(decimal: string): string {
  const negative = decimal.startsWith('-');
  const [whole = '0', fraction = ''] = decimal.replace(/^-/, '').split('.');
  const grouped = BigInt(whole).toLocaleString('en-US');
  return `${negative ? '-' : ''}$${grouped}.${fraction.padEnd(2, '0')}`;
}

/** A rule-change log line's value as people read it: a mode by its name, anything else as kept. */
export function ruleValue(rule: string, value: string | null): string {
  if (value === null) return 'none';
  if (rule === 'trading_mode') return MODE_NAMES[value] ?? value;
  return value;
}
