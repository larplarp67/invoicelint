/**
 * The `invoicelint` command line, as a function so it can be tested without
 * spawning processes. src/cli.ts is the thin executable entry point.
 */
import { glob, readFile, stat } from 'node:fs/promises';
import { Command, CommanderError, InvalidArgumentError, Option } from 'commander';
import type { ValidationReport } from '../engine.ts';
import { decodeInvoiceBytes } from '../decode.ts';
import { VERSION, validate } from '../index.ts';
import type { Issue } from '../types.ts';

/** Exit codes: 0 = no errors, 1 = errors found, 2 = usage error. */
export const EXIT = { OK: 0, ISSUES: 1, USAGE: 2 } as const;

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Raw bytes: decoding (BOM, UTF-16, declared XML encoding) happens in decodeInvoiceBytes. */
  readFile: (path: string) => Promise<Uint8Array>;
  exists: (path: string) => Promise<boolean>;
  /** Expand a wildcard pattern to matching file paths. */
  glob: (pattern: string) => Promise<string[]>;
}

async function nodeGlob(pattern: string): Promise<string[]> {
  // Windows shells don't expand wildcards, and fs.glob wants "/" separators.
  const normalized = process.platform === 'win32' ? pattern.replaceAll('\\', '/') : pattern;
  const matches: string[] = [];
  for await (const match of glob(normalized)) matches.push(match);
  return matches.sort();
}

export const nodeIo: CliIo = {
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
};

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

interface CheckOptions {
  format: 'pretty' | 'json';
  formatIn: 'auto' | 'json' | 'ubl';
  pack?: string[];
  rateWindowDays?: number;
}

interface FileResult {
  file: string;
  report: ValidationReport;
}

const LABEL: Record<Issue['severity'], string> = {
  error: 'ERROR',
  warning: 'WARN ',
  info: 'info ',
};

function pretty(results: readonly FileResult[]): string {
  const out: string[] = [];
  for (const { file, report } of results) {
    const counts = `${report.errors.length} error(s), ${report.warnings.length} warning(s)`;
    const tier = report.tier === undefined ? '' : ` · tier ${report.tier}`;
    const format = report.format === undefined ? '' : ` (${report.format.toUpperCase()})`;
    // A report that is ok only because nothing ran (e.g. a credit note) is not a pass.
    const status = !report.ok ? 'FAIL' : report.packs.length === 0 ? 'NOT CHECKED' : 'PASS';
    out.push(`${file}${format}: ${status}${tier} · ${counts}`);
    for (const issue of [...report.errors, ...report.warnings, ...report.infos]) {
      const field = issue.field === '' ? '' : `  [${issue.field}]`;
      out.push(`  ${LABEL[issue.severity]} ${issue.ruleId}${field}`);
      out.push(`         ${issue.message}`);
      if (issue.severity !== 'info') {
        if (issue.fix !== undefined) out.push(`         Fix: ${issue.fix}`);
        if (issue.citation !== undefined) out.push(`         Source: ${issue.citation}`);
      }
    }
    if (report.packs.length === 0) out.push('  (no rule packs ran)');
    out.push('');
  }
  return `${out.join('\n')}\n`;
}

async function check(args: string[], opts: CheckOptions, io: CliIo): Promise<number> {
  const results: FileResult[] = [];
  const { files, unmatched } = await expandArgs(args, io);
  let usageError = unmatched.length > 0;
  for (const pattern of unmatched) io.stderr(`invoicelint: no files match ${pattern}\n`);
  for (const file of files) {
    let text: string;
    try {
      const decoded = decodeInvoiceBytes(await io.readFile(file));
      if (!decoded.ok) throw new Error(decoded.reason);
      text = decoded.text;
    } catch (err) {
      io.stderr(
        `invoicelint: cannot read ${file}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      usageError = true;
      continue;
    }
    try {
      const report = validate(text, {
        format: opts.formatIn,
        ...(opts.pack ? { packs: opts.pack } : {}),
        ...(opts.rateWindowDays === undefined ? {} : { rateTransitionDays: opts.rateWindowDays }),
      });
      results.push({ file, report });
    } catch (err) {
      // Programmer/usage errors from validate(): unknown pack, bad options.
      io.stderr(`invoicelint: ${err instanceof Error ? err.message : String(err)}\n`);
      return EXIT.USAGE;
    }
  }

  if (opts.format === 'json') {
    io.stdout(`${JSON.stringify({ version: VERSION, files: results }, null, 2)}\n`);
  } else if (results.length > 0) {
    io.stdout(pretty(results));
  }
  if (usageError) return EXIT.USAGE;
  return results.every((r) => r.report.ok) ? EXIT.OK : EXIT.ISSUES;
}

/** Run the CLI with the given arguments (without "node" and the script path). */
export async function runCli(args: readonly string[], io: CliIo = nodeIo): Promise<number> {
  let exitCode: number = EXIT.OK;
  const program = new Command()
    .name('invoicelint')
    .description('Check invoices for Canadian GST/HST input tax credit requirements and tax math.')
    .version(VERSION)
    .exitOverride()
    .configureOutput({ writeOut: io.stdout, writeErr: io.stderr });

  program
    .command('check')
    .description('Check one or more invoice files (JSON or UBL 2.1 XML)')
    .argument('<file...>', 'invoice files; wildcards like *.xml are expanded on every OS')
    .addOption(
      new Option('-f, --format <format>', 'output format')
        .choices(['pretty', 'json'])
        .default('pretty'),
    )
    .addOption(
      new Option('--format-in <format>', 'input format (auto: XML if the file starts with "<")')
        .choices(['auto', 'json', 'ubl'])
        .default('auto'),
    )
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
      exitCode = await check(files, opts, io);
    });

  try {
    await program.parseAsync([...args], { from: 'user' });
  } catch (err) {
    if (err instanceof CommanderError) {
      // --help and --version surface as CommanderError with exitCode 0.
      return err.exitCode === 0 ? EXIT.OK : EXIT.USAGE;
    }
    throw err;
  }
  return exitCode;
}
