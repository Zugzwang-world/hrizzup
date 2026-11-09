import { describe, expect, it } from 'vitest';
import { newRecordId } from './record-id.ts';

describe("a new market's ID", () => {
  it('is a version 7 UUID in lower case, later ones sorting after earlier ones', () => {
    const first = newRecordId();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const later = newRecordId();
    expect(later.slice(0, 13) >= first.slice(0, 13)).toBe(true);
  });
});
