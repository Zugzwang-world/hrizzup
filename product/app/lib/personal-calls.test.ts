import { describe, expect, it } from 'vitest';
import { isPersonalCall } from './personal-calls.ts';

describe('which calls carry the session’s token', () => {
  it('not the public reads, so the edge keeps serving them to everyone', () => {
    for (const path of [['health'], ['markets', 'list'], ['auth', 'settings']]) {
      expect(isPersonalCall(path), path.join('.')).toBe(false);
    }
  });

  it('every personal call', () => {
    for (const path of [
      ['me'],
      ['markets', 'trade'],
      ['markets', 'cancelOrder'],
      ['portfolio', 'positions'],
      ['portfolio', 'orders'],
      ['admin', 'markets', 'list'],
      ['auth', 'emailCode'],
    ]) {
      expect(isPersonalCall(path), path.join('.')).toBe(true);
    }
  });

  it('and any call this copy of the contract does not know, as the contract counts it: never kept', () => {
    expect(isPersonalCall(['no', 'such', 'call'])).toBe(true);
    expect(isPersonalCall([])).toBe(true);
    expect(isPersonalCall(['markets'])).toBe(true);
  });
});
