import { thumbHashToDataURL } from 'thumbhash';

/**
 * Pictures on the design pages. Real screens will load images through Cloudflare's image
 * service (blueprint section 13); the design pages have no media storage, so the one example
 * image whose file exists in the agreement's world (our Bitcoin chart) is drawn here instead,
 * and every other picture shows its blurred placeholder, as a real screen does while an image
 * loads or when it never does.
 */

/** A placeholder (a ThumbHash, in base64) as a small image address for CSS backgrounds. */
export function placeholderImage(thumbhash: string): string {
  return thumbHashToDataURL(Uint8Array.from(Buffer.from(thumbhash, 'base64')));
}

// Bitcoin's week (the agreement's example chart, `examples/bitcoin-week-chart.webp`): down to
// about $93,000 on Wednesday, back above $100,000 by Sunday night.
const week = [98_400, 96_100, 93_200, 94_800, 97_300, 99_100, 100_900];
const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const x = (i: number) => 110 + i * 170;
const y = (v: number) => 590 - ((v - 90_000) / 14_000) * 500;

function chartSvg(): string {
  const line = week.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(6)} 590 L${x(0)} 590 Z`;
  const labels = days
    .map((d, i) => `<text x="${x(i)}" y="640" text-anchor="middle">${d}</text>`)
    .join('');
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675" font-family="system-ui, sans-serif">',
    '<rect width="1200" height="675" fill="#0E1422"/>',
    `<line x1="80" x2="1150" y1="${y(100_000)}" y2="${y(100_000)}" stroke="#F7931A" stroke-width="3" stroke-dasharray="10 10"/>`,
    `<text x="80" y="${y(100_000) - 16}" fill="#F7931A" font-size="30" font-weight="600">$100,000</text>`,
    `<path d="${area}" fill="#F7931A" fill-opacity="0.14"/>`,
    `<path d="${line}" fill="none" stroke="#FFFFFF" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"/>`,
    `<circle cx="${x(2)}" cy="${y(week[2] ?? 0).toFixed(1)}" r="12" fill="#FFFFFF"/>`,
    `<text x="${x(2)}" y="${(y(week[2] ?? 0) + 56).toFixed(1)}" text-anchor="middle" fill="#FFFFFF" font-size="30">$93,200</text>`,
    `<circle cx="${x(6)}" cy="${y(week[6] ?? 0).toFixed(1)}" r="12" fill="#FFFFFF"/>`,
    `<g fill="#9AA6B5" font-size="28">${labels}</g>`,
    '<text x="80" y="80" fill="#FFFFFF" font-size="40" font-weight="700">Bitcoin, the past week</text>',
    '</svg>',
  ].join('');
}

/** The design pages' stand-in for our media storage: a file's place in storage, to its image. */
export const exampleMedia: Readonly<Record<string, string>> = {
  'examples/bitcoin-week-chart.webp': `data:image/svg+xml,${encodeURIComponent(chartSvg())}`,
};
