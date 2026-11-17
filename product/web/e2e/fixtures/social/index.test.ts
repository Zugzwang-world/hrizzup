import { describe, expect, it, vi } from 'vitest';
import { ensureSocialFixtures, socialFixtures } from './index.ts';

describe('the social fixtures', () => {
  const context = { baseURL: 'https://preview.example.test', headers: { cookie: 'a=b' } };

  it('each have a name of their own and a way to make them, whichever areas have added theirs', () => {
    // No area is named here, so R5 and R6 adding their fixtures side by side edit none of this.
    for (const fixture of socialFixtures) {
      expect(fixture.name.length, 'a name').toBeGreaterThan(0);
      expect(typeof fixture.ensure, fixture.name).toBe('function');
    }
    expect(new Set(socialFixtures.map((fixture) => fixture.name)).size).toBe(socialFixtures.length);
  });

  it('make none without failing', async () => {
    await expect(ensureSocialFixtures(context, [])).resolves.toBeUndefined();
  });

  it('are made one after another in order, each given the site and the admin’s headers', async () => {
    const order: string[] = [];
    const make = (name: string) => ({
      name,
      ensure: vi.fn(async () => {
        order.push(name);
      }),
    });
    const [first, second] = [make('a story'), make('an agent')];
    await ensureSocialFixtures(context, [first, second]);
    expect(order).toEqual(['a story', 'an agent']);
    expect(first.ensure).toHaveBeenCalledWith(context);
  });

  it('stop at the first that fails, and name it', async () => {
    const after = { name: 'later', ensure: vi.fn(async () => undefined) };
    const broken = {
      name: 'an agent',
      ensure: async () => {
        throw new Error('nope');
      },
    };
    await expect(ensureSocialFixtures(context, [broken, after])).rejects.toThrow(
      `Couldn't make the social fixture "an agent"`,
    );
    expect(after.ensure).not.toHaveBeenCalled();
  });
});
