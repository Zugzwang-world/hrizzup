import { parseArgs } from 'node:util';
import { callCommand } from './call.ts';
import type { Ctx } from './context.ts';
import { CastError, refuse } from './errors.ts';
import { checkEnvironment } from './guard.ts';
import { inboxCommand } from './inbox.ts';
import { makeCommand, retireCommand } from './make.ts';
import { type Output, show } from './redact.ts';
import { reportCommand } from './report.ts';
import { endCommand, showCommand, startCommand } from './runs.ts';
import { snapshotCommand } from './snapshot.ts';
import { checkCommand, loadCommand, withdrawCommand } from './stories.ts';
import { uploadCommand } from './upload.ts';

/** What `--help` prints: the commands (rule 3.1), with how to run them. */
export const USAGE = `cast: the test cast on staging (docs/social/r17-design.md)

Run it as:  pnpm --silent --filter @hrizzup/web run cast <command> ...
The commands marked (D) run under staging's keys:
            infra/doppler/run stg -- pnpm --silent --filter @hrizzup/web run cast <command> ...

  make (D)                      make or resume each member
  retire [member] (D)           revoke what a member holds, and move it to its next number
  stories check <file>          fill in ids and validate a set file, offline
  stories load <file> (D)       save the set (it becomes the current one)
  stories withdraw (D)          unpin every member from the set, then withdraw each story
  run start | end | show        open or close a run; show says who is next and the run's tally
  call <member|-> GET|POST <path> [--body <file>|-]
                                the passthrough: only the calls the design lists
  inbox <member>                unanswered replies, oldest first
  upload <member> <file> (--description <file> | --transcript <file> --still <id>)
                                get the link, send the file, say it is done; prints the media id
  snapshot after-run-<n> [--wait]
                                what the board and the desks showed once run n's writes settled
                                (6 minutes after its last write; --wait waits, up to 20 minutes more)
  report [--runs a,b]           compare two runs' snapshots and threads: PASS or FAIL for R1 to R9
  --help                        this text

Files are named inside the store (~/.config/hrizzup/cast): story sets in stories/, bodies, media and
their words in work/. Nothing secret is ever printed. Exit codes: 0 done, 1 the API refused, 2 this
script refused, 3 no answer (run the same command again), 4 a limit (wait the seconds it says).`;

/** `parseArgs`, with its own message (which quotes the arguments) replaced by ours. */
function parse<T extends Record<string, { type: 'string' } | { type: 'boolean' }>>(
  args: string[],
  options: T,
) {
  try {
    return parseArgs({ args, options, allowPositionals: true, strict: true });
  } catch {
    throw refuse('Those arguments are not ones that command takes: see --help');
  }
}

type Job = (ctx: Ctx) => Promise<void> | void;

/** Checks the arguments and picks the command; nothing is opened or built until they are right. */
function plan(argv: string[]): Job {
  const [command, ...rest] = argv;
  switch (command) {
    case 'make':
      if (rest.length > 0) throw refuse('`make` takes no arguments');
      return makeCommand;
    case 'retire': {
      const [member, ...more] = rest;
      if (more.length > 0) throw refuse('`retire` takes at most one member');
      return (ctx) => retireCommand(ctx, member);
    }
    case 'stories': {
      const [sub, file, ...more] = rest;
      if (sub === 'check' && file && more.length === 0) return (ctx) => checkCommand(ctx, file);
      if (sub === 'load' && file && more.length === 0) return (ctx) => loadCommand(ctx, file);
      if (sub === 'withdraw' && file === undefined) return withdrawCommand;
      throw refuse('Use `stories check <file>`, `stories load <file>` or `stories withdraw`');
    }
    case 'run': {
      const [sub, ...more] = rest;
      if (more.length > 0) throw refuse('`run` takes start, end or show');
      if (sub === 'start') return startCommand;
      if (sub === 'end') return endCommand;
      if (sub === 'show') return showCommand;
      throw refuse('Use `run start`, `run end` or `run show`');
    }
    case 'call': {
      const { values, positionals } = parse(rest, { body: { type: 'string' } });
      const [member, method, target, ...more] = positionals;
      if (!member || !method || !target || more.length > 0) {
        throw refuse('Use `call <member|-> GET|POST <path> [--body <file>|-]`');
      }
      return (ctx) =>
        callCommand(ctx, {
          member,
          method,
          target,
          ...(values.body === undefined ? {} : { body: values.body }),
        });
    }
    case 'inbox': {
      const [member, ...more] = rest;
      if (!member || more.length > 0) throw refuse('Use `inbox <member>`');
      return (ctx) => inboxCommand(ctx, member);
    }
    case 'upload': {
      const { values, positionals } = parse(rest, {
        description: { type: 'string' },
        transcript: { type: 'string' },
        still: { type: 'string' },
      });
      const [member, file, ...more] = positionals;
      if (!member || !file || more.length > 0) {
        throw refuse(
          'Use `upload <member> <file> (--description <file> | --transcript <file> --still <id>)`',
        );
      }
      return (ctx) =>
        uploadCommand(ctx, {
          member,
          file,
          ...(values.description === undefined ? {} : { description: values.description }),
          ...(values.transcript === undefined ? {} : { transcript: values.transcript }),
          ...(values.still === undefined ? {} : { still: values.still }),
        });
    }
    case 'snapshot': {
      const { values, positionals } = parse(rest, { wait: { type: 'boolean' } });
      const [label, ...more] = positionals;
      if (!label || more.length > 0) throw refuse('Use `snapshot after-run-<n> [--wait]`');
      return (ctx) => snapshotCommand(ctx, { label, wait: values.wait === true });
    }
    case 'report': {
      const { values, positionals } = parse(rest, { runs: { type: 'string' } });
      if (positionals.length > 0) throw refuse('Use `report [--runs <a>,<b>]`');
      return (ctx) => reportCommand(ctx, values.runs === undefined ? {} : { runs: values.runs });
    }
    default:
      throw refuse(`${command} is not a command: see --help`);
  }
}

async function dispatch(argv: string[], io: Output, makeCtx: () => Ctx): Promise<void> {
  const [command] = argv;
  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    io.out(USAGE);
    return;
  }
  const job = plan(argv);
  const ctx = makeCtx();
  // Every command: never a production Doppler config, and a SUPABASE_URL only if it is staging's.
  checkEnvironment(ctx.env);
  await job(ctx);
}

/** Runs the command and answers its exit code. Nothing but redacted text is ever printed. */
export async function main(argv: string[], io: Output, makeCtx: () => Ctx): Promise<number> {
  try {
    await dispatch(argv, io, makeCtx);
    return 0;
  } catch (error) {
    if (error instanceof CastError) {
      io.err(`cast: ${error.message}`);
      if (error.detail !== undefined) io.err(show(error.detail));
      return error.exit;
    }
    // Anything else is a fault in the script: its name only, never its text (which could quote an address).
    const name = error instanceof Error ? error.name : 'unknown';
    io.err(
      `cast: stopped by an unexpected error (${name}); nothing was printed that could hold a secret`,
    );
    return 2;
  }
}
