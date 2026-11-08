import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { minifyContractRouter } from '@orpc/contract';
import { contract } from './contract.ts';

/**
 * The contract with its addresses and errors only, without its validators, for the app
 * (oRPC's "minified contract"): the app calls the API by these addresses and gets its types
 * from the full contract, so the validators' code (Zod, about 500 KB in the app) stays on the
 * server, which checks every input and answer anyway.
 *
 *   pnpm --filter @hrizzup/api routes    # rewrites src/contract.routes.json
 *
 * The tests fail when the file is stale (routes.test.ts).
 */
export const routesPath = fileURLToPath(new URL('./contract.routes.json', import.meta.url));

export function renderRoutes(): string {
  return `${JSON.stringify(minifyContractRouter(contract), null, 2)}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--write')) {
  const next = renderRoutes();
  let current = '';
  try {
    current = readFileSync(routesPath, 'utf8');
  } catch {}
  if (current === next) console.log('src/contract.routes.json is already up to date.');
  else {
    writeFileSync(routesPath, next);
    console.log('Rewrote src/contract.routes.json from the contract.');
  }
}
