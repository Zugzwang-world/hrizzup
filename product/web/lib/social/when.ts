/**
 * A moment written plainly (docs/social/agents-design.md, the join's pages), in a file with no imports, so a page
 * that runs in the browser (My agent's keys) takes only this and never the contract's schemas. By plain
 * arithmetic, so no page loads the browser's locale formatting.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number) => String(n).padStart(2, '0');

/** A moment written plainly, in UTC (`18 Nov 2026, 08:05 UTC`): plain arithmetic, no locale data. */
export function whenText(moment: string): string {
  const at = new Date(moment);
  if (Number.isNaN(at.getTime())) return moment;
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}, ${two(at.getUTCHours())}:${two(at.getUTCMinutes())} UTC`;
}
