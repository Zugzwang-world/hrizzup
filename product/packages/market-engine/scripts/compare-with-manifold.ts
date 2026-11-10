/**
 * Shows how this package's copy of Manifold's maths differs from Manifold's own code.
 *
 *   pnpm --filter @hrizzup/market-engine compare <folder holding Manifold's repository> [--diff]
 *
 * For each file brought from Manifold (src/manifold/), it takes Manifold's version from that
 * folder, makes the same import changes the README lists ("What changed", "In every file"),
 * formats it with Biome exactly as ours is formatted, and compares it with ours. What differs
 * should be only the changes the README lists. With `--diff` it prints those differences.
 *
 * Check out the commit in the README to check our copy, or a newer commit to see what Manifold
 * has changed since. It only reads Manifold's files as text; nothing of Manifold's is run.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const ourDir = join(packageDir, 'src', 'manifold');
const repoRoot = join(packageDir, '..', '..', '..');

// Files in src/manifold that are ours, not Manifold's, and the one trimmed copy.
const ours = new Set(['contract.ts', 'api/utils.ts', 'perps/oracle.ts', 'perps/adjacent-msry.ts']);
const trimmed = new Set(['new-contract.ts']);
// Kept exactly as Manifold wrote it apart from its import lines, so Biome skips it.
const unformatted = new Set(['calculate-cpmm-arbitrage.ts']);

const [manifoldDir, ...flags] = process.argv.slice(2);
if (!manifoldDir || !existsSync(join(manifoldDir, 'common', 'src'))) {
  console.error('Usage: compare <folder holding Manifold repository> [--diff]');
  process.exit(2);
}
const showDiff = flags.includes('--diff');
const manifoldSrc = join(manifoldDir, 'common', 'src');

const listFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listFiles(join(dir, entry.name))
      : entry.name.endsWith('.ts')
        ? [join(dir, entry.name)]
        : [],
  );

// The import changes our coding rules need (README, "What changed", "In every file").
const rewriteImports = (rel: string, text: string) => {
  const here = dirname(rel);
  let out = text.replace(/(from\s+)(['"])([^'"]+)(['"])/g, (_match, from, q1, spec, q2) => {
    let target = spec as string;
    if (target === 'lodash') return `${from}${q1}lodash-es${q2}`;
    if (target.startsWith('common/')) target = target.slice('common/'.length);
    else if (target.startsWith('.')) target = normalize(join(here, target));
    else return `${from}${q1}${spec}${q2}`;
    let path = relative(here, `${target}.ts`);
    if (!path.startsWith('.')) path = `./${path}`;
    return `${from}${q1}${path}${q2}`;
  });
  if (rel.endsWith('.test.ts')) {
    const used = ['describe', 'expect', 'it', 'test'].filter((name) =>
      new RegExp(`\\b${name}(\\.each)?\\(`).test(out),
    );
    out = `import { ${used.join(', ')} } from 'vitest'\n${out}`;
  }
  return out;
};

const formatLikeOurs = (rel: string, text: string) => {
  const result = spawnSync(
    'pnpm',
    ['exec', 'biome', 'check', '--write', `--stdin-file-path=${join(ourDir, rel)}`],
    { cwd: repoRoot, input: text, encoding: 'utf8' },
  );
  // Biome still prints the formatted text when lint findings remain; those are ours to see in
  // the comparison, not a failure here. No text at all means Biome itself failed.
  if (!result.stdout)
    throw new Error(`Biome couldn't format ${rel}: ${result.stderr || result.error}`);
  return result.stdout;
};

const scratch = mkdtempSync(join(tmpdir(), 'compare-with-manifold-'));
let differing = 0;
for (const path of listFiles(ourDir).sort()) {
  const rel = relative(ourDir, path);
  if (ours.has(rel)) {
    console.log(`ours     ${rel}`);
    continue;
  }
  const theirs = join(manifoldSrc, rel);
  if (!existsSync(theirs)) {
    console.log(`missing  ${rel} (not in Manifold's common/src at this commit)`);
    differing++;
    continue;
  }
  const rewritten = rewriteImports(rel, readFileSync(theirs, 'utf8'));
  const expected = unformatted.has(rel) ? rewritten : formatLikeOurs(rel, rewritten);
  const expectedPath = join(scratch, rel.replaceAll('/', '__'));
  writeFileSync(expectedPath, expected);
  const diff = spawnSync(
    'diff',
    ['-u', '--label', `manifold/${rel}`, '--label', `ours/${rel}`, expectedPath, path],
    { encoding: 'utf8' },
  );
  if (diff.status === 0) {
    console.log(`same     ${rel}`);
    continue;
  }
  differing++;
  const changed = diff.stdout.split('\n').filter((l) => /^[+-][^+-]/.test(l)).length;
  console.log(`changed  ${rel} (${changed} lines${trimmed.has(rel) ? ', trimmed copy' : ''})`);
  if (showDiff) console.log(diff.stdout);
}
const licence = (dir: string) => readFileSync(join(dir, 'LICENSE.md'), 'utf8');
const sameLicence = licence(manifoldDir) === licence(ourDir);
console.log(`${sameLicence ? 'same    ' : 'changed '} LICENSE.md`);
console.log(
  `\n${differing} file(s) differ from Manifold's after the import changes and formatting.`,
);
