import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.test.ts'],
    // Playwright's own tests (*.spec.ts) run in the Screen check, not here.
    exclude: ['node_modules/**', '.next/**', '**/*.spec.ts'],
    environment: 'node',
  },
  resolve: { alias: { '@': new URL('.', import.meta.url).pathname } },
});
