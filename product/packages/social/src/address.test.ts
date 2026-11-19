import { describe, expect, it } from 'vitest';
import { NO_ADDRESS, normaliseAddress, visitorKeyOf } from './address.ts';

/**
 * Which visitor an address is (address.ts): an IPv4 address whole, an IPv6 address as its /64 block, an IPv4-mapped
 * IPv6 address as its IPv4 address, and anything else nothing at all. Documentation addresses only (RFC 5737 and
 * RFC 3849): none is a real person's.
 */

describe('an IPv4 address', () => {
  it('stays whole', () => {
    for (const address of ['203.0.113.7', '0.0.0.0', '255.255.255.255', '10.0.0.1']) {
      expect(normaliseAddress(address), address).toBe(address);
    }
    expect(normaliseAddress('  203.0.113.7 ')).toBe('203.0.113.7');
  });

  it('is nothing when it is not four parts of 0 to 255 with no leading zero, or has a zone', () => {
    for (const bad of [
      '256.0.0.1',
      '1.2.3',
      '1.2.3.4.5',
      '01.2.3.4',
      '1.2.3.04',
      '1.2.3.-4',
      '1..3.4',
      '1.2.3.4%eth0',
      '1.2.3.4:80',
      '0x7f.0.0.1',
    ]) {
      expect(normaliseAddress(bad), bad).toBeNull();
    }
  });
});

describe('an IPv6 address', () => {
  it('is its first 64 bits, from the full form and from every `::` form', () => {
    expect(normaliseAddress('2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
    expect(normaliseAddress('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
    expect(normaliseAddress('2001:db8:1:2::1')).toBe('2001:db8:1:2::/64');
    expect(normaliseAddress('2001:db8:1:2::')).toBe('2001:db8:1:2::/64');
    expect(normaliseAddress('2001:db8:1:2:0:0:0:1')).toBe('2001:db8:1:2::/64');
    expect(normaliseAddress('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(normaliseAddress('2001:db8::')).toBe('2001:db8:0:0::/64');
    expect(normaliseAddress('::1')).toBe('0:0:0:0::/64');
    expect(normaliseAddress('::')).toBe('0:0:0:0::/64');
    expect(normaliseAddress('1::')).toBe('1:0:0:0::/64');
    expect(normaliseAddress('1:2:3:4:5:6:7::')).toBe('1:2:3:4::/64');
    expect(normaliseAddress('::2:3:4:5:6:7:8')).toBe('0:2:3:4::/64');
  });

  it('is one visitor for every address of a /64, and another for the next /64', () => {
    const block = [
      '2001:db8:1:2::',
      '2001:db8:1:2::1',
      '2001:db8:1:2:ffff:ffff:ffff:ffff',
      '2001:DB8:1:2:abcd:ef01:2345:6789',
      '2001:0db8:0001:0002:0000:0000:0000:0001',
    ];
    const keys = new Set(block.map((address) => normaliseAddress(address)));
    expect(keys).toEqual(new Set(['2001:db8:1:2::/64']));
    for (const other of [
      '2001:db8:1:3::1',
      '2001:db8:1:1:ffff:ffff:ffff:ffff',
      '2001:db8:2:2::1',
      '2001:db9:1:2::1',
    ]) {
      expect(normaliseAddress(other), other).not.toBe('2001:db8:1:2::/64');
    }
  });

  it('is written in lower case with no leading zeros, whatever case it came in', () => {
    expect(normaliseAddress('2001:DB8:ABCD:0012::5')).toBe('2001:db8:abcd:12::/64');
    expect(normaliseAddress('FE80::1')).toBe('fe80:0:0:0::/64');
  });

  it('drops a zone index and the brackets around it', () => {
    expect(normaliseAddress('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    expect(normaliseAddress('fe80::1%25eth0')).toBe('fe80:0:0:0::/64');
    expect(normaliseAddress('[2001:db8:1:2::1]')).toBe('2001:db8:1:2::/64');
    expect(normaliseAddress('[fe80::1%eth0]')).toBe('fe80:0:0:0::/64');
    expect(normaliseAddress('fe80::1%')).toBeNull();
    expect(normaliseAddress('%eth0')).toBeNull();
  });

  it('keeps nothing of the low 64 bits in what it answers', () => {
    const key = normaliseAddress('2001:db8:1:2:aaaa:bbbb:cccc:dddd') ?? '';
    for (const low of ['aaaa', 'bbbb', 'cccc', 'dddd']) expect(key).not.toContain(low);
  });
});

describe('an IPv4-mapped IPv6 address', () => {
  it('is the IPv4 address it carries, in any case or form', () => {
    expect(normaliseAddress('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(normaliseAddress('::FFFF:203.0.113.7')).toBe('203.0.113.7');
    expect(normaliseAddress('0:0:0:0:0:ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(normaliseAddress('0000:0000:0000:0000:0000:ffff:cb00:7107')).toBe('203.0.113.7');
    expect(normaliseAddress('::ffff:cb00:7107')).toBe('203.0.113.7');
    expect(normaliseAddress('[::ffff:203.0.113.7]')).toBe('203.0.113.7');
    // The same visitor as the plain IPv4 address.
    expect(normaliseAddress('::ffff:203.0.113.7')).toBe(normaliseAddress('203.0.113.7'));
  });

  it('is only the ::ffff:0:0/96 block: any other address with an IPv4 tail is its /64', () => {
    expect(normaliseAddress('::fffe:203.0.113.7')).toBe('0:0:0:0::/64');
    expect(normaliseAddress('1::ffff:203.0.113.7')).toBe('1:0:0:0::/64');
    expect(normaliseAddress('64:ff9b::203.0.113.7')).toBe('64:ff9b:0:0::/64');
    expect(normaliseAddress('::203.0.113.7')).toBe('0:0:0:0::/64');
  });
});

describe('what is not an address', () => {
  it('is nothing', () => {
    for (const bad of [
      '',
      ' ',
      'hello',
      'unknown',
      'none',
      '2001:db8::1::2',
      '2001:db8:1:2:3:4:5:6:7',
      '1:2:3:4:5:6:7',
      ':1:2:3:4:5:6:7',
      '1:2:3:4:5:6:7:',
      ':::',
      '12345::',
      'g::1',
      '2001:db8::1.2.3',
      '2001:db8::1.2.3.256',
      '::1.2.3.4.5',
      '[::1',
      '::1]',
      '[[::1]]',
      '1.2.3.4, 5.6.7.8',
      '2001:db8::1/64',
      '2001:db8::%%',
    ]) {
      expect(normaliseAddress(bad), JSON.stringify(bad)).toBeNull();
    }
    // Spaces around an address are trimmed, as for an IPv4 address.
    expect(normaliseAddress(' 2001:db8::1 ')).toBe('2001:db8:0:0::/64');
    for (const notText of [null, undefined, 5, {}, [], true]) {
      expect(normaliseAddress(notText as never)).toBeNull();
    }
  });
});

describe('the visitor a note is counted under', () => {
  it('is the address’s normalised form, whatever the environment', () => {
    for (const failClosed of [true, false]) {
      expect(visitorKeyOf('203.0.113.7', failClosed)).toBe('203.0.113.7');
      expect(visitorKeyOf('2001:db8:1:2::9', failClosed)).toBe('2001:db8:1:2::/64');
      expect(visitorKeyOf('::ffff:203.0.113.7', failClosed)).toBe('203.0.113.7');
    }
  });

  it('is one shared bucket for a note with no address where there must be one (staging, production)', () => {
    expect(NO_ADDRESS).toBe('none');
    for (const missing of [null, undefined, '', 'not an address']) {
      expect(visitorKeyOf(missing, true), String(missing)).toBe('none');
    }
  });

  it('is nothing, so no cap, for a note with no address where there need not be one (a preview, this Mac)', () => {
    for (const missing of [null, undefined, '', 'not an address']) {
      expect(visitorKeyOf(missing, false), String(missing)).toBeNull();
    }
  });
});
