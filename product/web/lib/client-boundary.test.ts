import { readdirSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// A module that starts with 'use client' is a client module. When a server file (any file without
// that directive) imports from one, Next gives it a stand-in for each export, and only a component
// can be used through one: a constant or a function read from it is a stand-in that throws when it
// is called or turned into text, and a class string made from it carries that error's text into the
// page (R6's builder found it on /sandbox/keys, where `${PRIMARY}` was the button's class). Vitest
// has no server layer, so no render test sees it; this reads the source instead.
//
// The rule: a server file may import only components from a client module, or types. A component is
// told by its name: PascalCase with a lowercase second letter (`KeysPanel`, not `PRIMARY`). So a
// name like `Limits` is taken for a component even when it is a constant or a helper, and a
// PascalCase non-component is not caught; keep such values out of client modules. Shared values
// (class strings, limits, helpers) live in a module with no directive. Checked over app/,
// components/ and lib/; test files (*.test.ts, *.spec.ts) never run in the server layer, so they
// are left out. Not covered: dynamic `import()`, `require`, and `export *` (Next's loader
// rejects `export *` from a client module by itself).

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIRS = ['app', 'components', 'lib'];

/** Reads a file by its path from the web root; undefined when there is no such file. */
type Reader = (file: string) => string | undefined;

/** What a server file takes from a client module: a label to print, and whether it is a component. */
type Use = { file: string; module: string; name: string; component: boolean };

const isComponentName = (name: string) => /^[A-Z][a-z]/.test(name);

/** A source file the server layer could load: .ts or .tsx, not a test, not generated or installed. */
function isSource(file: string): boolean {
  if (!/\.tsx?$/.test(file)) return false;
  if (/\.(test|spec)\.tsx?$/.test(file)) return false;
  return !file.split('/').some((part) => part === 'node_modules' || part === '.next');
}

const parse = (file: string, text: string) =>
  ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

/** True when the file's directive prologue (the strings before any code) holds 'use client'. */
function hasUseClient(source: ts.SourceFile): boolean {
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) {
      return false;
    }
    if (statement.expression.text === 'use client') return true;
  }
  return false;
}

/** The file a module specifier names, from the web root: `@/…` or relative; packages are skipped. */
function resolveModule(from: string, specifier: string, read: Reader): string | undefined {
  let base: string;
  if (specifier.startsWith('@/')) base = specifier.slice(2);
  else if (specifier.startsWith('.')) base = posix.join(posix.dirname(from), specifier);
  else return undefined;
  return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find(
    (candidate) => read(candidate) !== undefined,
  );
}

/** Every use of a namespace import: `ns.Name` (judged on Name), or the namespace on its own. */
function namespaceUses(
  source: ts.SourceFile,
  local: string,
): { name: string; component: boolean }[] {
  const uses: { name: string; component: boolean }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === local && !ts.isNamespaceImport(node.parent)) {
      const parent = node.parent;
      if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
        const name = parent.name.text;
        uses.push({ name: `${local}.${name}`, component: isComponentName(name) });
      } else if (ts.isPropertyAccessExpression(parent) && parent.name === node) {
        // `other.ui`: a property that shares the name, not the namespace.
      } else if (!ts.isQualifiedName(parent)) {
        // A type name such as `ui.Props` is a QualifiedName and is erased; anything else is the
        // namespace itself, used as a value.
        uses.push({ name: `* as ${local}`, component: false });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return uses;
}

/** Every value a server file takes from a client module (types left out), judged one by one. */
function clientUses(files: string[], read: Reader): Use[] {
  const parsed = new Map<string, ts.SourceFile | undefined>();
  const sourceOf = (file: string) => {
    if (!parsed.has(file)) {
      const text = read(file);
      parsed.set(file, text === undefined ? undefined : parse(file, text));
    }
    return parsed.get(file);
  };

  const uses: Use[] = [];
  for (const file of files) {
    const source = sourceOf(file);
    if (!source || hasUseClient(source)) continue;

    const take = (specifier: ts.Expression): string | undefined => {
      if (!ts.isStringLiteral(specifier)) return undefined;
      const module = resolveModule(file, specifier.text, read);
      const target = module === undefined ? undefined : sourceOf(module);
      return module !== undefined && target && hasUseClient(target) ? module : undefined;
    };

    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause;
        if (!clause || clause.isTypeOnly) continue; // `import 'x'` and `import type …`
        const module = take(statement.moduleSpecifier);
        if (module === undefined) continue;
        if (clause.name) {
          uses.push({
            file,
            module,
            name: clause.name.text,
            component: isComponentName(clause.name.text),
          });
        }
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) {
          for (const use of namespaceUses(source, bindings.name.text)) {
            uses.push({ file, module, ...use });
          }
        } else if (bindings) {
          for (const element of bindings.elements) {
            if (element.isTypeOnly) continue;
            // Judged on the name the module exports; for `default` there is only the local name.
            const exported = (element.propertyName ?? element.name).text;
            const name = exported === 'default' ? element.name.text : exported;
            uses.push({ file, module, name, component: isComponentName(name) });
          }
        }
      } else if (
        ts.isExportDeclaration(statement) &&
        statement.moduleSpecifier &&
        !statement.isTypeOnly &&
        statement.exportClause &&
        ts.isNamedExports(statement.exportClause)
      ) {
        const module = take(statement.moduleSpecifier);
        if (module === undefined) continue;
        for (const element of statement.exportClause.elements) {
          if (element.isTypeOnly) continue;
          const name = (element.propertyName ?? element.name).text;
          uses.push({ file, module, name, component: isComponentName(name) });
        }
      }
    }
  }
  return uses;
}

/** Each offender as `file: name from module`. */
function offenders(files: string[], read: Reader): string[] {
  return clientUses(files, read)
    .filter((use) => !use.component)
    .map((use) => `${use.file}: ${use.name} from ${use.module}`);
}

function webFiles(): string[] {
  return DIRS.flatMap((dir) =>
    readdirSync(`${ROOT}${dir}`, { recursive: true, encoding: 'utf8' })
      .map((entry) => `${dir}/${entry.split('\\').join('/')}`)
      .filter(isSource),
  );
}

const readWeb: Reader = (file) => {
  try {
    return readFileSync(`${ROOT}${file}`, 'utf8');
  } catch {
    return undefined; // no such file, or a folder
  }
};

describe('server files and client modules', () => {
  it('no server file takes anything but a component from a client module', () => {
    expect(offenders(webFiles(), readWeb).join('\n')).toBe('');
  });

  it('really sees the tree: client modules exist and a known server-to-client import is found', () => {
    const files = webFiles();
    const clientModules = files.filter((file) => {
      const text = readWeb(file);
      return text !== undefined && hasUseClient(parse(file, text));
    });
    expect(clientModules.length).toBeGreaterThan(0);
    // The keys page (a server page) shows the keys panel (a client module): if this edge is gone,
    // the resolver or the page changed, so point it at another server-to-client import.
    expect(clientUses(files, readWeb)).toContainEqual({
      file: 'app/sandbox/keys/page.tsx',
      module: 'components/sandbox/keys-panel.tsx',
      name: 'KeysPanel',
      component: true,
    });
  });

  it('takes the test files out of the set', () => {
    expect(isSource('lib/a.test.ts')).toBe(false);
    expect(isSource('e2e/a.spec.ts')).toBe(false);
    expect(isSource('components/x/node_modules/y.ts')).toBe(false);
    expect(isSource('lib/a.ts')).toBe(true);
    expect(isSource('app/page.tsx')).toBe(true);
    expect(isSource('app/globals.css')).toBe(false);
  });
});

describe('the scan, on small made-up trees', () => {
  const CLIENT = "'use client';\nexport const PRIMARY = 'x';\nexport function KeysPanel() {}\n";
  const tree = (files: Record<string, string>) => {
    const read: Reader = (file) => files[file];
    return offenders(Object.keys(files), read);
  };
  const server = (imports: string, path = 'app/page.tsx') =>
    tree({ 'components/ui.tsx': CLIENT, [path]: `${imports}\nexport default function P() {}\n` });

  it('flags a constant read through the @ alias from a .tsx client module', () => {
    expect(server("import { PRIMARY } from '@/components/ui.tsx';")).toEqual([
      'app/page.tsx: PRIMARY from components/ui.tsx',
    ]);
  });

  it('flags through a relative path to a .ts client module, and without an extension', () => {
    const files = {
      'lib/hooks.ts': "'use client';\nexport const useThing = () => 1;\n",
      'components/a.tsx': "import { useThing } from '../lib/hooks.ts';\n",
      'components/b.tsx': "import { useThing } from '../lib/hooks';\n",
      'components/c.tsx': "import { useThing } from '@/lib/hooks';\n",
    };
    expect(tree(files)).toEqual([
      'components/a.tsx: useThing from lib/hooks.ts',
      'components/b.tsx: useThing from lib/hooks.ts',
      'components/c.tsx: useThing from lib/hooks.ts',
    ]);
  });

  it('flags through a folder index', () => {
    const files = {
      'components/ui/index.ts': "'use client';\nexport const LIMIT = 5;\n",
      'app/page.tsx': "import { LIMIT } from '@/components/ui';\n",
    };
    expect(tree(files)).toEqual(['app/page.tsx: LIMIT from components/ui/index.ts']);
  });

  it('accepts components', () => {
    expect(server("import { KeysPanel } from '@/components/ui.tsx';")).toEqual([]);
  });

  it('accepts types, written either way', () => {
    expect(
      server(
        [
          "import type { PRIMARY } from '@/components/ui.tsx';",
          "import { type PRIMARY as Other, KeysPanel } from '@/components/ui.tsx';",
          "import type Thing from '@/components/ui.tsx';",
          "export type { PRIMARY } from '@/components/ui.tsx';",
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('judges a renamed import by the name the module exports', () => {
    expect(
      server("import { PRIMARY as Primary, KeysPanel as panel } from '@/components/ui.tsx';"),
    ).toEqual(['app/page.tsx: PRIMARY from components/ui.tsx']);
  });

  it('judges a default import by its local name', () => {
    expect(server("import Panel from '@/components/ui.tsx';")).toEqual([]);
    expect(server("import primary from '@/components/ui.tsx';")).toEqual([
      'app/page.tsx: primary from components/ui.tsx',
    ]);
    expect(server("import { default as primary } from '@/components/ui.tsx';")).toEqual([
      'app/page.tsx: primary from components/ui.tsx',
    ]);
  });

  it('judges a namespace import by what is taken from it', () => {
    expect(
      server(
        "import * as ui from '@/components/ui.tsx';\nexport const A = () => <ui.KeysPanel />;\ntype T = ui.Props;\n",
        'app/page.tsx',
      ),
    ).toEqual([]);
    expect(
      server("import * as ui from '@/components/ui.tsx';\nexport const A = ui.PRIMARY;\n"),
    ).toEqual(['app/page.tsx: ui.PRIMARY from components/ui.tsx']);
    expect(
      server("import * as ui from '@/components/ui.tsx';\nexport const A = { ...ui };\n"),
    ).toEqual(['app/page.tsx: * as ui from components/ui.tsx']);
  });

  it('flags a re-export of a constant, and ignores export *', () => {
    expect(server("export { PRIMARY } from '@/components/ui.tsx';")).toEqual([
      'app/page.tsx: PRIMARY from components/ui.tsx',
    ]);
    expect(server("export * from '@/components/ui.tsx';")).toEqual([]);
  });

  it('reads the directive, not a mention of it', () => {
    const notClient = "// 'use client'\nconst x = 'use client';\nexport const PRIMARY = x;\n";
    const afterComments = '/** Parts. */\n// more\n"use client";\nexport const PRIMARY = \'x\';\n';
    const base = { 'app/page.tsx': "import { PRIMARY } from '@/components/ui.tsx';\n" };
    expect(tree({ ...base, 'components/ui.tsx': notClient })).toEqual([]);
    expect(tree({ ...base, 'components/ui.tsx': afterComments })).toEqual([
      'app/page.tsx: PRIMARY from components/ui.tsx',
    ]);
  });

  it('leaves client files, other server files, packages and missing files alone', () => {
    const files = {
      'components/ui.tsx': CLIENT,
      'components/panel.tsx': `${"'use client';\nimport { PRIMARY } from './ui.tsx';\n"}export const A = PRIMARY;\n`,
      'lib/plain.ts': 'export const LIMIT = 5;\n',
      'app/page.tsx': [
        "import { LIMIT } from '@/lib/plain.ts';",
        "import Link from 'next/link';",
        "import { Gone } from '@/components/gone.tsx';",
      ].join('\n'),
    };
    expect(tree(files)).toEqual([]);
  });
});
