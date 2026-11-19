/**
 * Which visitor an address is, for the cap on views per address (docs/social/r11-design.md, decision 2 and the
 * cap in `views.ts`): pure functions, with nothing imported and no Node, so they are tested on their own.
 *
 * - **An IPv6 address is its /64 block.** One IPv6 user holds a whole /64 (2^64 addresses) and could rotate
 *   through it to get past a cap by address, so an IPv6 address becomes its first 64 bits, and every address of the
 *   block is one visitor. An IPv4-mapped IPv6 address (`::ffff:203.0.113.7`) is the IPv4 address it carries; an
 *   IPv4 address stays whole.
 * - **The result is only ever hashed.** It is the text that goes into the visitor day token's HMAC
 *   (`viewTokens` in `views.ts`); no key, log or stored value holds it, or the address it came from.
 */

/** The visitor of a note that has no address, where there must be one (staging and production): one shared bucket. */
export const NO_ADDRESS = 'none';

const HEX_GROUP = /^[0-9a-f]{1,4}$/i;

/** An IPv4 address as its four octets, or null: four decimal parts of 0 to 255, none written with a leading zero. */
function octetsOf(text: string): number[] | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    octets.push(octet);
  }
  return octets;
}

/** An IPv6 address as its eight 16-bit groups, `::` and an IPv4 tail (`::ffff:1.2.3.4`) expanded; null for anything else. */
function groupsOf(text: string): number[] | null {
  if (!/^[0-9a-f:.]+$/i.test(text) || !text.includes(':')) return null;
  let written = text;
  const lastColon = written.lastIndexOf(':');
  const tail = written.slice(lastColon + 1);
  if (tail.includes('.')) {
    const octets = octetsOf(tail);
    if (octets === null) return null;
    const high = ((octets[0] as number) << 8) | (octets[1] as number);
    const low = ((octets[2] as number) << 8) | (octets[3] as number);
    written = `${written.slice(0, lastColon + 1)}${high.toString(16)}:${low.toString(16)}`;
  }
  const halves = written.split('::');
  if (halves.length > 2) return null;
  const listOf = (part: string | undefined) =>
    part === undefined || part === '' ? [] : part.split(':');
  const head = listOf(halves[0]);
  const rest = halves.length === 2 ? listOf(halves[1]) : [];
  // Without `::` all eight groups are written; with it, it stands for one group or more.
  if (halves.length === 1 ? head.length !== 8 : head.length + rest.length > 7) return null;
  const groups = [...head, ...Array<string>(8 - head.length - rest.length).fill('0'), ...rest];
  if (!groups.every((group) => HEX_GROUP.test(group))) return null;
  return groups.map((group) => Number.parseInt(group, 16));
}

/**
 * The visitor an address stands for: an IPv4 address as `a.b.c.d`, an IPv4-mapped IPv6 address as the IPv4
 * address it carries, and any other IPv6 address as its first 64 bits, `2001:db8:1:2::/64` (lower case, no leading
 * zeros). `[…]` around an IPv6 address and a zone index (`%eth0`) are dropped. Anything that is not an address is null.
 */
export function normaliseAddress(address: unknown): string | null {
  if (typeof address !== 'string') return null;
  let text = address.trim();
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  const zone = text.indexOf('%');
  if (zone !== -1) {
    // A zone index belongs to an IPv6 address only.
    if (!text.slice(0, zone).includes(':') || !/^[0-9a-z._~-]+$/i.test(text.slice(zone + 1))) {
      return null;
    }
    text = text.slice(0, zone);
  }
  if (!text.includes(':')) {
    const octets = octetsOf(text);
    return octets === null ? null : octets.join('.');
  }
  const groups = groupsOf(text);
  if (groups === null) return null;
  const [a, b, c, d, e, f, g, h] = groups as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  // ::ffff:a.b.c.d, written either way: the first 80 bits zero, then ffff, then the IPv4 address.
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0xffff) {
    return [g >> 8, g & 255, h >> 8, h & 255].join('.');
  }
  return `${[a, b, c, d].map((group) => group.toString(16)).join(':')}::/64`;
}

/**
 * The key a note's cap is counted under, or null for a note that is not capped. An address that can be told apart
 * is its normalised form. Where there must be an address (`failClosed`: staging and production, where
 * `visitorLimitsApply` is true) and a note has none, or one that isn't an address, they all share one bucket
 * (`none`), so they are capped too. Elsewhere (previews, this Mac) such a note is not capped.
 */
export function visitorKeyOf(
  address: string | null | undefined,
  failClosed: boolean,
): string | null {
  const normalised = normaliseAddress(address);
  if (normalised !== null) return normalised;
  return failClosed ? NO_ADDRESS : null;
}
