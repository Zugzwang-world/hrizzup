/**
 * The package's type declarations (types/), written from its source with its own TypeScript
 * settings:
 *
 *   pnpm --filter @hrizzup/market-engine types     # rewrites types/
 *
 * Why: Manifold's maths is kept close to Manifold's own code, so it passes TypeScript only with
 * `noUncheckedIndexedAccess` off (tsconfig.json says why). A package that imports TypeScript
 * source checks it again under its own settings, where that option is on, so every package that
 * used the maths (the ledger, then the website through the typed API) would fail its type
 * check on Manifold's code. Instead they read these declarations (package.json, "exports"),
 * which describe exactly what src/index.ts offers; the code they run is still src/.
 *
 * src/types.test.ts fails when types/ differs from what this writes now, so a change to the
 * maths can't leave stale declarations behind.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
export const typesDir = join(packageDir, 'types');

const NOTICE =
  '// Written by scripts/types.ts from src/ (pnpm --filter @hrizzup/market-engine types). Do not edit.\n';

/** Every declaration file, by its path under types/, as the package's source gives it now. */
export function declarations(): Map<string, string> {
  const config = ts.getParsedCommandLineOfConfigFile(
    join(packageDir, 'tsconfig.json'),
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
  );
  if (!config) throw new Error('Cannot read tsconfig.json');
  const options: ts.CompilerOptions = {
    ...config.options,
    noEmit: false,
    declaration: true,
    emitDeclarationOnly: true,
    rootDir: join(packageDir, 'src'),
    outDir: typesDir,
  };
  const program = ts.createProgram([join(packageDir, 'src', 'index.ts')], options);
  const problems = ts.getPreEmitDiagnostics(program);
  if (problems.length > 0) {
    throw new Error(ts.formatDiagnostics(problems, ts.createCompilerHost(options)));
  }
  const files = new Map<string, string>();
  program.emit(
    undefined,
    (fileName, text) => {
      files.set(relative(typesDir, fileName), NOTICE + text);
    },
    undefined,
    true,
  );
  return files;
}

/** The declaration files in types/ now, by their path under types/. */
export function written(): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.set(relative(typesDir, path), readFileSync(path, 'utf8'));
    }
  };
  try {
    walk(typesDir);
  } catch {
    // No types/ yet.
  }
  return files;
}

if (process.argv.includes('--write')) {
  rmSync(typesDir, { recursive: true, force: true });
  for (const [path, text] of declarations()) {
    const target = join(typesDir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text);
  }
  console.log(`Wrote ${relative(process.cwd(), typesDir)}`);
}
