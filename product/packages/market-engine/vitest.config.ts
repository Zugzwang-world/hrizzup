import { configDefaults, defineConfig } from 'vitest/config';

// Three groups, run one after the other. Manifold's heaviest fuzz test (conservation-grid) runs
// close to its limit on GitHub's small machines, and went over it beside the other heavy unit
// tests (the money tests, the types build) when they all ran at once (R5, 10 November 2026); the
// perp's long simulation (src/perp/simulation.test.ts) is heavy computing too. So the unit tests
// run first, then the simulation, then the fuzz test on its own (R3's recommendation), and no
// limit has to move.
const simulation = 'src/perp/simulation.test.ts';
const fuzz = 'src/manifold/conservation-grid.test.ts';

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          exclude: [...configDefaults.exclude, simulation, fuzz],
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: { name: 'simulation', include: [simulation], sequence: { groupOrder: 1 } },
      },
      {
        extends: true,
        test: { name: 'fuzz', include: [fuzz], sequence: { groupOrder: 2 } },
      },
    ],
  },
});
