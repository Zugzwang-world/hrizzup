import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The app's Node scripts, and the app's own logic that runs without a phone (no React Native
    // inside: lib/auth/pieces.ts, say). The app's screens are checked by Maestro.
    include: ['scripts/**/*.test.ts', 'lib/**/*.test.ts'],
    environment: 'node',
  },
});
