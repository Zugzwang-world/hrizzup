import { configDefaults, defineConfig } from 'vitest/config';

// Two groups, run one after the other. The perp's long simulation (src/perp/simulation.test.ts)
// is heavy computing; run beside the unit tests it would take their time on GitHub's small
// machines, and Manifold's heaviest fuzz test (conservation-grid) already runs close to its
// limit there. So the unit tests run first, then the simulation, and no limit has to move.
const simulation = 'src/perp/simulation.test.ts';

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          exclude: [...configDefaults.exclude, simulation],
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: { name: 'simulation', include: [simulation], sequence: { groupOrder: 1 } },
      },
    ],
  },
});
