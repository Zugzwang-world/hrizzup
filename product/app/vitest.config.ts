import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only the app's Node scripts have unit tests; the app's screens are checked by Maestro.
    include: ['scripts/**/*.test.ts'],
    environment: 'node',
  },
});
