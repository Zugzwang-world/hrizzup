import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CastError, limited, noAnswer, refuse } from './errors.ts';
import { fakeCode, fakeKey, type Harness, harness } from './harness.ts';
import { main, USAGE } from './main.ts';
import { realContext } from './real.ts';

/** The command line: `--help` touches nothing, every refusal has its exit code, nothing printed carries a secret. */

/** Starting Node, and making six members a stop at a time, take a little: give them room on a slow machine. */
vi.setConfig({ testTimeout: 60_000 });

const ENTRY = new URL('../cast.ts', import.meta.url).pathname;

describe('node scripts/cast.ts', () => {
  it('prints the commands for --help, help and no arguments, touching no network and no store', () => {
    for (const args of [['--help'], ['help'], ['-h'], []]) {
      const run = spawnSync(process.execPath, [ENTRY, ...args], {
        encoding: 'utf8',
        // No store, no keys: nothing it needs is set, so a command that tried would fail.
        env: {
          PATH: process.env.PATH ?? '',
          HOME: '/nonexistent',
          HRIZZUP_CAST_HOME: '/nonexistent/cast',
        } as unknown as NodeJS.ProcessEnv,
        timeout: 30_000,
      });
      expect(run.status, args.join(' ')).toBe(0);
      expect(run.stderr).toBe('');
      for (const command of [
        'make',
        'retire',
        'stories check',
        'stories load',
        'stories withdraw',
        'run start',
        'call',
        'inbox',
        'upload',
        'snapshot',
        'report',
      ]) {
        expect(run.stdout).toContain(command);
      }
      expect(run.stdout).toBe(`${USAGE}\n`);
    }
  });

  it('refuses a command that is not one, with exit 2 and a line on stderr', () => {
    const run = spawnSync(process.execPath, [ENTRY, 'nonsense'], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        HRIZZUP_CAST_HOME: '/nonexistent/cast',
      } as unknown as NodeJS.ProcessEnv,
      timeout: 30_000,
    });
    expect(run.status).toBe(2);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain('nonsense is not a command');
  });
});

describe('main()', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });
  afterEach(() => h.cleanup());

  const run = (...argv: string[]) => main(argv, h.io, () => h.ctx);
  const err = () =>
    h.writes
      .filter((write) => write.stream === 'err')
      .map((write) => write.text)
      .join('');

  it('prints the usage without building a context for --help', async () => {
    let built = 0;
    const code = await main(['--help'], h.io, () => {
      built++;
      return h.ctx;
    });
    expect(code).toBe(0);
    expect(built).toBe(0);
  });

  it.each([
    [['nonsense'], 'is not a command'],
    [['make', 'now'], 'takes no arguments'],
    [['retire', 'a', 'b'], 'at most one member'],
    [['stories'], 'stories check'],
    [['stories', 'load'], 'stories check'],
    [['stories', 'withdraw', 'x'], 'stories check'],
    [['call', '-', 'GET'], 'Use `call'],
    [['call', '-', 'GET', '/social/board', '--nope'], 'not ones that command takes'],
    [['inbox'], 'Use `inbox'],
    [['upload', 'a'], 'Use `upload'],
    [['upload', 'a', 'b', '--nope', 'x'], 'not ones that command takes'],
  ])('refuses %j with exit 2', async (argv, text) => {
    expect(await run(...argv)).toBe(2);
    expect(err()).toContain(text);
  });

  it('says the snapshot and the report come in the second pass', async () => {
    expect(await run('snapshot', 'after-run-1')).toBe(2);
    expect(await run('report')).toBe(2);
    expect(err()).toContain('second pass');
  });

  it('checks the arguments before it builds anything', async () => {
    let built = 0;
    const code = await main(['upload', 'a'], h.io, () => {
      built++;
      return h.ctx;
    });
    expect(code).toBe(2);
    expect(built).toBe(0);
  });

  it("refuses a production Doppler config and a Supabase project that is not staging's, for every command", async () => {
    h.ctx.env = { DOPPLER_CONFIG: 'prd' };
    expect(await run('run', 'show')).toBe(2);
    expect(err()).toContain('production Doppler config');
    h.ctx.env = { SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co' };
    expect(await run('inbox', 'explainer')).toBe(2);
    expect(h.server.requests).toEqual([]);
  });

  it("refuses a command that needs staging's keys, and says how to run it, when there are none", async () => {
    h.ctx.auth = () => {
      throw refuse(
        "This command needs staging's keys: run it as `infra/doppler/run stg -- pnpm --silent --filter @hrizzup/web run cast …`",
      );
    };
    for (const argv of [
      ['make'],
      ['retire'],
      ['stories', 'load', 'a.json'],
      ['stories', 'withdraw'],
    ]) {
      expect(await run(...argv), argv.join(' ')).toBe(2);
    }
    expect(err()).toContain('infra/doppler/run stg');
    expect(h.server.requests).toEqual([]);
  });

  it("answers each exit code its error carries, and prints an API refusal's JSON without its secrets", async () => {
    const secret = fakeKey(1);
    const cases: Array<[CastError, number]> = [
      [
        new CastError(1, 'the API refused', {
          code: 'CONFLICT',
          secret,
          data: { reason: 'invite_used' },
          message: `uses ${secret}`,
        }),
        1,
      ],
      [refuse('refused'), 2],
      [noAnswer('POST /x got no answer'), 3],
      [limited('wait 30 seconds'), 4],
    ];
    for (const [error, code] of cases) {
      h.writes.length = 0;
      h.ctx.auth = () => {
        throw error;
      };
      expect(await run('make')).toBe(code);
      expect(err()).toContain(`cast: ${error.message}`);
      expect(err()).not.toContain(secret);
    }
    expect(err()).toContain('wait 30 seconds');
  });

  it('prints only the name of an error that is a fault in the script, never its words', async () => {
    h.ctx.auth = () => {
      throw new TypeError(`broke on ${fakeCode(2)} at https://example.com/a?X-Amz-Signature=abc`);
    };
    expect(await run('make')).toBe(2);
    expect(err()).toContain('(TypeError)');
    expect(err()).not.toContain('broke on');
    expect(err()).not.toContain(fakeCode(2));
  });
});

describe('the real context', () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });
  afterEach(() => h.cleanup());

  it("refuses a command that needs staging's keys when the run has none, and a production config", () => {
    const context = realContext({ HRIZZUP_CAST_HOME: h.home });
    expect(() => context.auth()).toThrow(/needs staging's keys/);
    try {
      context.auth();
    } catch (error) {
      expect((error as CastError).exit).toBe(2);
    }
    const production = realContext({ HRIZZUP_CAST_HOME: h.home, DOPPLER_CONFIG: 'prd' });
    expect(() => production.auth()).toThrow(/production Doppler config/);
    const elsewhere = realContext({
      HRIZZUP_CAST_HOME: h.home,
      SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'stand-in',
      SUPABASE_SECRET_KEY: 'stand-in',
    });
    expect(() => elsewhere.auth()).toThrow(/not staging's Supabase project/);
  });

  it('takes its store from HRIZZUP_CAST_HOME and its working folder from INIT_CWD', () => {
    const context = realContext({ HRIZZUP_CAST_HOME: h.home, INIT_CWD: '/somewhere/else' });
    expect(context.store.home).toBe(h.home);
    expect(context.cwd).toBe('/somewhere/else');
  });
});
