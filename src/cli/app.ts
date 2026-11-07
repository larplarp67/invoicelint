/**
 * The `invoicelint` command line, as a function so it can be tested without
 * spawning processes. src/cli.ts is the thin executable entry point. This is
 * the only place (with src/cli.ts) that touches the file system.
 */
import { glob, readFile, stat } from 'node:fs/promises';
import { Command, CommanderError, InvalidArgumentError, Option } from 'commander';
import { decodeInvoiceBytes } from '../decode.ts';
import { BUILTIN_PACKS, VERSION, validate } from '../index.ts';
import { EXIT_CODES, type FileResult, INPUT_ISSUES, exitCode, toJsonOutput } from '../output.ts';
import { renderPretty } from './pretty.ts';

/** Exit codes: 0 = ok, 1 = issues found, 2 = usage or input error. */
export const EXIT = {
  OK: EXIT_CODES.OK,
  ISSUES: EXIT_CODES.ISSUES,
  USAGE: EXIT_CODES.INPUT,
} as const;

/** Everything the CLI needs from its environment, so tests can fake it. */
export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Raw bytes: decoding (BOM, UTF-16, declared XML encoding) happens in decodeInvoiceBytes. */
  readFile: (path: string) => Promise<Uint8Array>;
  exists: (path: string) => Promise<boolean>;
  /** Expand a wildcard pattern to matching file paths. */
  glob: (pattern: string) => Promise<string[]>;
  /** Whether stdout is a terminal (pretty output by default) or a pipe/file (JSON by default). */
  isTTY: boolean;
  /** Whether to use colours in pretty output. */
  color: boolean;
  /** Terminal width, for wrapping. */
  columns: number;
}

async function nodeGlob(pattern: string): Promise<string[]> {
  // Windows shells don't expand wildcards, and fs.glob wants "/" separators.
  const normalized = process.platform === 'win32' ? pattern.replaceAll('\\', '/') : pattern;
  const matches: string[] = [];
  for await (const match of glob(normalized)) matches.push(match);
  return matches.sort();
}

/** Colours follow NO_COLOR / FORCE_COLOR (https://no-color.org), else whether stdout is a TTY. */
export function useColor(env: Record<string, string | undefined>, isTTY: boolean): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '0') return true;
  return isTTY;
}

/** The real environment. */
export function nodeIo(): CliIo {
  // isTTY is undefined (not false) when stdout is a pipe; picocolors would treat
  // createColors(undefined) as "use the default", which is on for Windows.
  // @types/node says isTTY is a boolean, but it is undefined when stdout is a pipe.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion
  const isTTY = Boolean(process.stdout.isTTY);
  return {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    readFile: (path) => readFile(path),
    exists: async (path) => {
      try {
        await stat(path);
        return true;
      } catch {
        return false;
      }
    },
    glob: nodeGlob,
    isTTY,
    color: useColor(process.env, isTTY),
    // undefined when stdout is not a terminal
    columns: process.stdout.columns > 0 ? process.stdout.columns : 100,
  };
}

interface CheckOptions {
  format?: 'pretty' | 'json';
  formatIn: 'auto' | 'json' | 'ubl';
  pack?: string[];
  rateWindowDays?: number;
  strict?: boolean;
  quiet?: boolean;
  verbose?: boolean;
}

const WILDCARD = /[*?[\]{}]/;

/** Expand wildcard arguments; a name that exists as written is never expanded. */
async function expandArgs(
  args: readonly string[],
  io: CliIo,
): Promise<{ files: string[]; unmatched: string[] }> {
  const files: string[] = [];
  const unmatched: string[] = [];
  for (const arg of args) {
    if (!WILDCARD.test(arg) || (await io.exists(arg))) {
      files.push(arg);
      continue;
    }
    const matches = await io.glob(arg);
    if (matches.length === 0) unmatched.push(arg);
    else files.push(...matches);
  }
  return { files, unmatched };
}

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

async function readOne(file: string, opts: CheckOptions, io: CliIo): Promise<FileResult> {
  let bytes: Uint8Array;
  try {
    bytes = await io.readFile(file);
  } catch (err) {
    return {
      file,
      inputError: {
        ruleId: INPUT_ISSUES.UNREADABLE,
        severity: 'error',
        field: '',
        message: `The file could not be read: ${errorMessage(err)}`,
      },
    };
  }
  const decoded = decodeInvoiceBytes(bytes);
  if (!decoded.ok) {
    return {
      file,
      inputError: {
        ruleId: INPUT_ISSUES.UNDECODABLE,
        severity: 'error',
        field: '',
        message: `The file could not be decoded: ${decoded.reason}.`,
        fix: 'Save the file as UTF-8.',
      },
    };
  }
  const report = validate(decoded.text, {
    format: opts.formatIn,
    ...(opts.pack ? { packs: opts.pack } : {}),
    ...(opts.rateWindowDays === undefined ? {} : { rateTransitionDays: opts.rateWindowDays }),
  });
  return { file, report };
}

async function check(args: string[], opts: CheckOptions, io: CliIo): Promise<number> {
  const { files, unmatched } = await expandArgs(args, io);
  for (const pattern of unmatched) io.stderr(`invoicelint: no files match ${pattern}\n`);
  if (files.length === 0) return EXIT.USAGE;

  const results: FileResult[] = [];
  for (const file of files) results.push(await readOne(file, opts, io));

  const judge = { strict: opts.strict === true };
  const format = opts.format ?? (io.isTTY ? 'pretty' : 'json');
  if (format === 'json') {
    io.stdout(`${JSON.stringify(toJsonOutput(results, VERSION, judge), null, 2)}\n`);
  } else {
    io.stdout(
      renderPretty(results, {
        ...judge,
        verbose: opts.verbose === true,
        quiet: opts.quiet === true,
        color: io.color,
        width: Number.isFinite(io.columns) ? Math.min(Math.max(io.columns, 60), 100) : 100,
      }),
    );
  }
  // An unmatched wildcard is a usage error even if other files were checked.
  return unmatched.length > 0 ? EXIT.USAGE : exitCode(results, judge);
}

function listRules(io: CliIo): number {
  const rows = BUILTIN_PACKS.flatMap((pack) =>
    pack.rules.map((r) => ({
      id: r.id,
      severity: r.severity,
      tier:
        r.appliesFromTier === undefined
          ? 'all'
          : r.appliesFromTier === 3
            ? '3'
            : `${r.appliesFromTier}+`,
      title: r.title,
    })),
  );
  const idWidth = Math.max(2, ...rows.map((r) => r.id.length));
  const line = (id: string, severity: string, tier: string, title: string) =>
    `${id.padEnd(idWidth)}  ${severity.padEnd(8)}  ${tier.padEnd(4)}  ${title}`;
  const out = [
    line('ID', 'SEVERITY', 'TIER', 'CHECKS'),
    ...rows.map((r) => line(r.id, r.severity, r.tier, r.title)),
  ];
  io.stdout(`${out.join('\n')}\n\nCitations and fix hints: docs/rules.md\n`);
  return EXIT.OK;
}

const EXAMPLES = `
Examples:
  invoicelint check invoice.json
  invoicelint check invoice.xml --verbose
  invoicelint check "invoices/**/*.{json,xml}"
  invoicelint check invoices/*.xml --format json > report.json
  invoicelint check invoice.json --strict      # warnings fail too
  invoicelint rules

Exit codes: 0 ok · 1 issues found · 2 usage or input error
Output: pretty in a terminal, JSON when piped (override with --format).
Colours: set NO_COLOR=1 to turn them off.`;

/** Run the CLI with the given arguments (without "node" and the script path). */
export async function runCli(args: readonly string[], io: CliIo = nodeIo()): Promise<number> {
  let code: number = EXIT.OK;
  const program = new Command()
    .name('invoicelint')
    .description(
      'Check Canadian invoices for the details a buyer needs to claim GST/HST input tax credits, and whether the tax math adds up.',
    )
    .version(VERSION)
    .exitOverride()
    .configureOutput({ writeOut: io.stdout, writeErr: io.stderr })
    .addHelpText('after', EXAMPLES);

  program
    .command('check')
    .description('Check invoice files (JSON or UBL 2.1 XML)')
    .argument(
      '<files...>',
      'invoice files; wildcards like "invoices/**/*.{json,xml}" are expanded on every OS',
    )
    .addOption(
      new Option(
        '-f, --format <format>',
        'output format (default: pretty in a terminal, json when piped)',
      ).choices(['pretty', 'json']),
    )
    .addOption(
      new Option('--format-in <format>', 'input format (auto: XML if the file starts with "<")')
        .choices(['auto', 'json', 'ubl'])
        .default('auto'),
    )
    .option('--strict', 'exit 1 on warnings too, not just errors')
    .option('-q, --quiet', 'print only the summary line')
    .option('-v, --verbose', 'also show info messages (tier, skipped checks, parser notes)')
    // One ID per flag (repeatable, or comma-separated). A variadic <id...> would
    // swallow the file names that follow it.
    .option(
      '-p, --pack <id>',
      'rule pack to run; repeat or comma-separate for several (default: all that apply)',
      (value: string, previous: string[] | undefined) => [
        ...(previous ?? []),
        ...value
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s !== ''),
      ],
    )
    .option(
      '--rate-window-days <days>',
      'days either side of a GST/HST rate change in which both rates are accepted, with a warning (default 60)',
      (value: string) => {
        if (!/^\d+$/.test(value)) throw new InvalidArgumentError('must be a whole number of days');
        return Number(value);
      },
    )
    .exitOverride()
    .action(async (files: string[], opts: CheckOptions) => {
      code = await check(files, opts, io);
    });

  program
    .command('rules')
    .description('List the rules (ID, severity, tier, what they check)')
    .exitOverride()
    .action(() => {
      code = listRules(io);
    });

  try {
    await program.parseAsync([...args], { from: 'user' });
  } catch (err) {
    if (err instanceof CommanderError) {
      // --help and --version surface as CommanderError with exitCode 0.
      return err.exitCode === 0 ? EXIT.OK : EXIT.USAGE;
    }
    if (err instanceof RangeError) {
      // Usage errors from validate(): unknown pack, bad option values.
      io.stderr(`invoicelint: ${err.message}\n`);
      return EXIT.USAGE;
    }
    throw err;
  }
  return code;
}
