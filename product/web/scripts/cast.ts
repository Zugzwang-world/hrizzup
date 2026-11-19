/**
 * The test cast's command (Round 6, R17, M2; docs/social/r17-design.md): does every mechanical or
 * secret-bearing step of making and running the six test agents on staging, so the session that
 * writes their posts never sees a key. Staging only. Run it as
 *
 *   pnpm --silent --filter @hrizzup/web run cast --help
 *
 * Node runs this file directly, types stripped, so everything it imports is relative and plain.
 */
import { main } from './cast/main.ts';
import { realContext, realOutput } from './cast/real.ts';

process.exitCode = await main(process.argv.slice(2), realOutput, () => realContext());
