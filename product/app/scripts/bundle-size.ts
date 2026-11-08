import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compare, type Limit, type Measurement, markdown } from './bundle.ts';

/**
 * The app's code-size check, part of the Speed check (blueprint section 14: "the app's code
 * size checked for unexplained growth").
 *
 *   node scripts/bundle-size.ts measure
 *     Builds the app's Android code bundle exactly as a build ships it (Hermes bytecode,
 *     `expo export`) and writes its size to dist/bundle-size.json.
 *   node scripts/bundle-size.ts compare <main's checkout of this folder> <output folder>
 *     Compares this checkout's measurement with main's, writes app.md (the app's rows of the
 *     table on the pull request) and fails on growth that isn't explained (bundle.ts).
 */

const APP = new URL('..', import.meta.url).pathname;

function measure() {
  const out = join(APP, 'dist', 'export');
  rmSync(out, { recursive: true, force: true });
  execFileSync('pnpm', ['exec', 'expo', 'export', '--platform', 'android', '--output-dir', out], {
    cwd: APP,
    stdio: 'inherit',
    env: { ...process.env, CI: '1' },
  });
  const metadata = JSON.parse(readFileSync(join(out, 'metadata.json'), 'utf8')) as {
    fileMetadata: { android: { bundle: string } };
  };
  const measurement: Measurement = {
    androidBytes: statSync(join(out, metadata.fileMetadata.android.bundle)).size,
  };
  mkdirSync(join(APP, 'dist'), { recursive: true });
  writeFileSync(join(APP, 'dist', 'bundle-size.json'), `${JSON.stringify(measurement)}\n`);
  console.log(`Android code bundle: ${measurement.androidBytes} bytes`);
}

function read<T>(file: string): T | null {
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : null;
}

function compareWithMain(mainApp: string, outFolder: string) {
  const head = read<Measurement>(join(APP, 'dist', 'bundle-size.json'));
  const headLimit = read<Limit>(join(APP, 'bundle-limit.json'));
  if (!head || !headLimit) throw new Error('Measure this checkout first (bundle-size.ts measure)');
  const base = read<Measurement>(join(mainApp, 'dist', 'bundle-size.json'));
  const baseLimit = read<Limit>(join(mainApp, 'bundle-limit.json'));
  const result = compare(head, base, headLimit, baseLimit);
  mkdirSync(outFolder, { recursive: true });
  writeFileSync(join(outFolder, 'app.md'), `${markdown(result)}\n`);
  console.log(markdown(result));
  if (!result.passes) process.exit(1);
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'measure') measure();
else if (command === 'compare' && rest.length === 2) compareWithMain(rest[0] ?? '', rest[1] ?? '');
else {
  console.error('Usage: node scripts/bundle-size.ts measure | compare <main app folder> <out>');
  process.exit(2);
}
