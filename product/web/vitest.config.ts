import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The website's own tsconfig keeps `jsx: preserve` for Next.js to compile; a test that renders a
  // component (`renderToStaticMarkup`) has no Next.js, so it compiles JSX the way React's runtime reads it.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    include: ['**/*.test.ts'],
    // Playwright's own tests (*.spec.ts) run in the Screen check, not here.
    exclude: ['node_modules/**', '.next/**', '**/*.spec.ts'],
    environment: 'node',
  },
  resolve: { alias: { '@': new URL('.', import.meta.url).pathname } },
});
