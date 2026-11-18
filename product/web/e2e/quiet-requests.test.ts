import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Every request a journey sends through Playwright goes through the quiet wrapper (Round 6, R16, M5: the
 * founder's done-test of 18 November 2026; support/quiet-request.ts). Playwright's request client writes every
 * header a request sent into the call log of any request that fails, and the reporters print that log into a
 * check's public log, so a journey's request that fails must name only its method and path. A raw send
 * (`request.get(…)`, `trader.fetch(…)`, `route.fetch(…)`) is refused here; `quiet(request).get(…)`,
 * `quietRoute(route).fetch(…)`, `call(…)` and `callWith(…)` are the ways to send.
 *
 * It reads every file under e2e with TypeScript's type checker, never as text: a receiver goes by a dozen names
 * (`request`, `as`, `anyone`, `admin`, `trader`…) and text can't tell `request.get(` from `searchParams.get(`.
 * Never give Turbo's `test` task an `inputs` list that leaves out `e2e/`: this guard covers a new journey only
 * because the journey's file is in the task's hash, so a cached pass can't hide it.
 */

const WEB = new URL('../', import.meta.url).pathname;
const E2E = join(WEB, 'e2e');
const QUIET = join(E2E, 'support/quiet-request.ts');
const PROOF = join(E2E, 'support/quiet-request.proof.test.ts');
const SOCIAL_CALLS = join(E2E, 'support/social-calls.ts');
const THIS_FILE = join(E2E, 'quiet-requests.test.ts');

/** The only two files that may send raw: the wrapper itself, and the proof that drives a real context. */
const ALLOWED = [QUIET, PROOF];

const SEND_NAMES = ['fetch', 'get', 'post', 'put', 'patch', 'delete', 'head'];
const HOW_TO_SEND =
  'send it through quiet(), quietRoute(), call() or callWith() from e2e/support/quiet-request.ts';

/** Every file under `folder` whose name matches, skipping installed packages and builds. */
function files(folder: string, name: RegExp): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(folder)) {
    if (['node_modules', '.next', '.git', '.turbo', 'dist'].includes(entry)) continue;
    const path = join(folder, entry);
    if (statSync(path).isDirectory()) found.push(...files(path, name));
    else if (name.test(entry)) found.push(path);
  }
  return found;
}

const normal = (path: string) => path.replaceAll('\\', '/');

type Send = {
  file: string;
  line: number;
  method: string;
  /** The Playwright type the method was used on. */
  on: 'APIRequestContext' | 'Route';
  /** Whether the allow-list, or a callback of `quietly` or `answerOf`, lets it stand. */
  allowed: boolean;
};

/** The compiler options the website's own type check uses (its tsconfig.json), read once. */
function compilerOptions(): ts.CompilerOptions {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    join(WEB, 'tsconfig.json'),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
      },
    },
  );
  if (!parsed) throw new Error("The website's tsconfig.json could not be read");
  if (parsed.errors.length > 0) {
    throw new Error(
      parsed.errors
        .map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n'))
        .join('\n'),
    );
  }
  return { ...parsed.options, noEmit: true };
}

/**
 * Whether `method` of `type` (made non-nullable, and each member of a union or intersection looked at) is a
 * member declared by Playwright's own `APIRequestContext` (or, for `fetch`, `Route`). Asked of the property's
 * declaration, not of the type's name, so a sub-interface (`interface Mine extends APIRequestContext {}`),
 * `Pick<APIRequestContext, 'get'>` and `Partial<APIRequestContext>` count as well.
 */
function playwrightType(
  checker: ts.TypeChecker,
  type: ts.Type,
  method: string,
): Send['on'] | undefined {
  const members = (t: ts.Type): ts.Type[] =>
    t.isUnionOrIntersection() ? t.types.flatMap(members) : [t];
  for (const member of members(checker.getApparentType(checker.getNonNullableType(type)))) {
    for (const declaration of checker.getPropertyOfType(member, method)?.declarations ?? []) {
      const declaredByPlaywright = normal(declaration.getSourceFile().fileName).endsWith(
        '/playwright-core/types/types.d.ts',
      );
      const owner = declaration.parent;
      if (!declaredByPlaywright || !ts.isInterfaceDeclaration(owner)) continue;
      if (owner.name.text === 'APIRequestContext') return 'APIRequestContext';
      if (owner.name.text === 'Route' && method === 'fetch') return 'Route';
    }
  }
  return undefined;
}

/** Whether `call` is a call of `quietly` (support/quiet-request.ts) or `answerOf` (support/social-calls.ts). */
function isGate(checker: ts.TypeChecker, call: ts.CallExpression): boolean {
  let symbol = checker.getSymbolAtLocation(call.expression);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  return (symbol?.declarations ?? []).some((declaration) => {
    const file = normal(declaration.getSourceFile().fileName);
    return (
      (symbol?.name === 'quietly' && file === normal(QUIET)) ||
      (symbol?.name === 'answerOf' && file === normal(SOCIAL_CALLS))
    );
  });
}

/** Whether the nearest function around `node` is passed, directly, as an argument to `quietly` or `answerOf`. */
function inAGateCallback(checker: ts.TypeChecker, node: ts.Node): boolean {
  let at: ts.Node | undefined = node.parent;
  while (at && !ts.isFunctionLike(at)) at = at.parent;
  const parent = at?.parent;
  return (
    at !== undefined &&
    parent !== undefined &&
    ts.isCallExpression(parent) &&
    parent.arguments.some((argument) => argument === at) &&
    isGate(checker, parent)
  );
}

const nameOf = (name: ts.PropertyName | ts.BindingName | undefined): string | undefined =>
  name !== undefined && (ts.isIdentifier(name) || ts.isStringLiteralLike(name))
    ? name.text
    : undefined;

/**
 * Every use of a sending method on Playwright's request context (or `fetch` on a route) in the given files:
 * a property access `x.get` (called or not, so `.bind` and `const f = x.get` count), an element access
 * `x['get']` (or `x[key]`, whose key's type is checked), and a binding `{ get } = x` (a declaration, a
 * parameter or an assignment).
 */
function findSends(program: ts.Program, paths: string[]): Send[] {
  const checker = program.getTypeChecker();
  const sends: Send[] = [];
  for (const path of paths) {
    const source = program.getSourceFile(path);
    if (!source) throw new Error(`${path} is not in the program`);
    const file = normal(source.fileName);
    /** Notes a use of `method` (named as `method`, or as any of `candidates`) on `receiver`, if it is Playwright's. */
    const note = (
      node: ts.Node,
      method: string,
      receiver: ts.Type | undefined,
      candidates: string[] = [method],
    ) => {
      if (!receiver) return;
      const on = candidates
        .filter((candidate) => SEND_NAMES.includes(candidate))
        .map((candidate) => playwrightType(checker, receiver, candidate))
        .find((found) => found !== undefined);
      if (!on) return;
      sends.push({
        file,
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        method,
        on,
        allowed: ALLOWED.map(normal).includes(file) || inAGateCallback(checker, node),
      });
    };
    const visit = (node: ts.Node) => {
      if (ts.isPropertyAccessExpression(node)) {
        note(node.name, node.name.text, checker.getTypeAtLocation(node.expression));
      } else if (ts.isElementAccessExpression(node)) {
        // The key's own type: `x['get']`, and a variable of a literal type, or a union of them (`x[m]`).
        // A key that isn't made only of string literals could be any method, so on Playwright's context it is named.
        const receiver = checker.getTypeAtLocation(node.expression);
        const key = checker.getTypeAtLocation(node.argumentExpression);
        const parts = key.isUnion() ? key.types : [key];
        if (parts.every((part) => part.isStringLiteral())) {
          for (const part of parts) {
            if (part.isStringLiteral()) note(node.argumentExpression, part.value, receiver);
          }
        } else {
          note(node.argumentExpression, '[key]', receiver, SEND_NAMES);
        }
      } else if (ts.isObjectBindingPattern(node)) {
        for (const element of node.elements) {
          const method = nameOf(element.propertyName ?? element.name);
          if (method) note(element, method, checker.getTypeAtLocation(node));
        }
      } else if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isObjectLiteralExpression(node.left)
      ) {
        for (const property of node.left.properties) {
          const method =
            ts.isShorthandPropertyAssignment(property) || ts.isPropertyAssignment(property)
              ? nameOf(property.name)
              : undefined;
          if (method) note(property, method, checker.getTypeAtLocation(node.right));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return sends.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

const label = (send: Send) => `${relative(WEB, send.file)}:${send.line} ${send.method}`;

describe('a journey sends every request through the quiet wrapper', () => {
  const everyFile = files(E2E, /\.ts$/);
  let program: ts.Program;
  let sends: Send[];

  beforeAll(() => {
    program = ts.createProgram({ rootNames: everyFile, options: compilerOptions() });
    sends = findSends(program, everyFile);
  }, 60_000);

  it('has no send outside the allow-list and the callbacks of quietly and answerOf', () => {
    const raw = sends.filter((send) => !send.allowed).map(label);
    expect(raw, `${raw.length} raw sends: ${HOW_TO_SEND}`).toEqual([]);
  });

  it('cannot pass by finding nothing: it scans the journeys and sees every send the wrapper itself makes', () => {
    expect(everyFile.length, 'the e2e files were found').toBeGreaterThan(50);
    const scanned = everyFile.filter((path) => program.getSourceFile(path) !== undefined);
    expect(scanned.length, 'the e2e files are in the program').toBe(everyFile.length);
    const inTheWrapper = sends.filter((send) => send.file === normal(QUIET));
    expect(
      [
        ...new Set(
          inTheWrapper.filter((send) => send.on === 'APIRequestContext').map((s) => s.method),
        ),
      ].sort(),
      "the wrapper's own sends, seen on Playwright's APIRequestContext",
    ).toEqual([...SEND_NAMES].sort());
    expect(
      inTheWrapper.some((send) => send.on === 'Route' && send.method === 'fetch'),
      "the wrapper's route.fetch, seen on Playwright's Route",
    ).toBe(true);
    // The callbacks of R5's and R6's social journeys are the other sends that stand.
    expect(
      sends.filter(
        (send) => send.allowed && send.file !== normal(QUIET) && send.file !== normal(PROOF),
      ).length,
      'the callbacks of quietly and answerOf',
    ).toBeGreaterThan(0);
  });

  it('allows exactly two files to send raw: the wrapper and its proof', () => {
    expect(ALLOWED.map((path) => relative(WEB, path))).toEqual([
      'e2e/support/quiet-request.ts',
      'e2e/support/quiet-request.proof.test.ts',
    ]);
    for (const path of ALLOWED) expect(statSync(path).isFile(), path).toBe(true);
  });

  /** One file in memory, added to the program the way a new journey would be, to prove what the scanner names. */
  const FORMS = join(E2E, 'support/scanner-forms-in-memory.ts');
  /** A line ending `// named: get, post` must be named for exactly those methods; `// allowed` stands; the rest are not sends. */
  const FORMS_TEXT = [
    "import type { APIRequestContext, Route } from '@playwright/test';",
    "import { quietly } from './quiet-request.ts';",
    '',
    'interface Mine extends APIRequestContext {}',
    '',
    'export async function forms(',
    '  ctx: APIRequestContext,',
    '  maybe: APIRequestContext | null | undefined,',
    '  route: Route,',
    '  mine: Mine,',
    "  picked: Pick<APIRequestContext, 'get' | 'fetch'>,",
    '  loose: Partial<APIRequestContext>,',
    ') {',
    "  await ctx.get('/a'); // named: get",
    "  await ctx['post']('/b'); // named: post",
    '  const { put } = ctx; // named: put',
    "  await maybe?.fetch('/c'); // named: fetch",
    '  const bound = ctx.get.bind(ctx); // named: get',
    '  await route.fetch(); // named: fetch',
    '  const { delete: remove, head } = ctx; // named: delete, head',
    "  await mine.get('/d'); // named: get",
    "  await picked.fetch('/e'); // named: fetch",
    "  await loose.get?.('/f'); // named: get",
    "  const some = 'get' as 'get' | 'post';",
    "  await ctx[some]('/g'); // named: get, post",
    "  const key = 'get' as string;",
    "  await ctx[key]('/h'); // named: [key]",
    "  const other = 'dispose' as 'dispose' | 'storageState';",
    '  await ctx[other](); // not a send',
    "  await quietly('GET', '/x', () => ctx.get('/x')); // allowed",
    "  await quietly('GET', '/y', async () => {",
    "    const inner = () => ctx.patch('/y'); // named: patch",
    '    return inner();',
    '  });',
    "  await quietly('GET', '/z', async () => {",
    "    const own = new Map<string, number>().get('z'); // not a send: a Map",
    '    return own;',
    '  });',
    '  return [put, bound, remove, head];',
    '}',
    '',
  ].join('\n');

  it('names each form of a send, allows a callback of quietly, and names a send in a function nested inside one', () => {
    const options = compilerOptions();
    const host = ts.createCompilerHost(options);
    const { getSourceFile, fileExists, readFile } = host;
    host.getSourceFile = (name, ...rest) =>
      normal(name) === normal(FORMS)
        ? ts.createSourceFile(name, FORMS_TEXT, options.target ?? ts.ScriptTarget.ES2022, true)
        : getSourceFile.call(host, name, ...rest);
    host.fileExists = (name) => normal(name) === normal(FORMS) || fileExists.call(host, name);
    host.readFile = (name) =>
      normal(name) === normal(FORMS) ? FORMS_TEXT : readFile.call(host, name);
    const withForms = ts.createProgram({ rootNames: [FORMS], options, host });
    const found = findSends(withForms, [FORMS]);
    const lines = FORMS_TEXT.split('\n');
    const wanted = lines.flatMap((text, index) => {
      const methods = /\/\/ named: (.*)$/.exec(text)?.[1]?.split(', ') ?? [];
      return methods.map((method) => `${index + 1} ${method}`);
    });
    expect(wanted.length, 'the forms were marked').toBeGreaterThan(10);
    const written = (list: Send[]) => list.map((send) => `${send.line} ${send.method}`).sort();
    expect(written(found.filter((send) => !send.allowed))).toEqual([...wanted].sort());
    // The send inside the callback itself stands, and is still a send the scanner saw.
    expect(found.filter((send) => send.allowed).map((send) => send.line)).toEqual(
      lines.flatMap((text, index) => (text.includes('// allowed') ? [index + 1] : [])),
    );
    // A `Map`'s own `get`, and a method of the context that sends nothing, are not sends.
    const notSends = lines.flatMap((text, index) =>
      text.includes('// not a send') ? [index + 1] : [],
    );
    expect(notSends.length).toBe(2);
    for (const line of notSends) expect(found.some((send) => send.line === line)).toBe(false);
  }, 60_000);

  it("has no `toBeOK(` and no `_fetchLog` in any e2e file (a failed `toBeOK` prints Playwright's call log)", () => {
    for (const path of everyFile) {
      if (path === THIS_FILE) continue;
      const text = readFileSync(path, 'utf8');
      expect(text, `${relative(WEB, path)} uses toBeOK`).not.toContain('toBeOK(');
      expect(text, `${relative(WEB, path)} reads a call log`).not.toContain('_fetchLog');
    }
  });
});
