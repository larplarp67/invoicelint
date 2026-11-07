/**
 * Multi-file results, their status and summary, and the stable JSON output
 * format (`invoicelint check --format json`). Browser-safe: no file system.
 * The JSON shape is documented in docs/json-output.md; bump
 * {@link JSON_OUTPUT_SCHEMA_VERSION} on any breaking change.
 */
import type { ValidationReport } from './engine.ts';
import type { Issue } from './types.ts';

/** Version of the JSON output shape. Bumped only on breaking changes. */
export const JSON_OUTPUT_SCHEMA_VERSION = 1;

/** Exit codes: 0 = ok, 1 = issues found, 2 = usage or input error. */
export const EXIT_CODES = { OK: 0, ISSUES: 1, INPUT: 2 } as const;

/** Rule IDs for files that could not be read or decoded (no report exists). */
export const INPUT_ISSUES = {
  /** The file could not be read (missing, permissions, a directory, ...). */
  UNREADABLE: 'INPUT-001',
  /** The file's bytes could not be decoded (unsupported declared encoding). */
  UNDECODABLE: 'INPUT-002',
} as const;

/** One checked file: its validation report, or why it could not be checked. */
export type FileResult =
  { file: string; report: ValidationReport } | { file: string; inputError: Issue };

/**
 * What happened to one file.
 * - `pass`: rules ran, no errors (and no warnings, when strict)
 * - `fail`: errors (or warnings, when strict)
 * - `not-checked`: recognized but no rules ran (e.g. a UBL credit note)
 * - `input-error`: unreadable, undecodable, or not a parseable invoice
 */
export type FileStatus = 'pass' | 'fail' | 'not-checked' | 'input-error';

/** Options that change how results are judged. */
export interface JudgeOptions {
  /** Treat warnings as failures (CLI `--strict`). */
  strict?: boolean;
}

/** The status of one file. A report with parse errors and no rules run counts as an input error. */
export function fileStatus(result: FileResult, options: JudgeOptions = {}): FileStatus {
  if ('inputError' in result) return 'input-error';
  const { report } = result;
  if (report.packs.length === 0) return report.errors.length > 0 ? 'input-error' : 'not-checked';
  if (report.errors.length > 0) return 'fail';
  if (options.strict === true && report.warnings.length > 0) return 'fail';
  return 'pass';
}

/** Totals across all files. */
export interface Summary {
  files: number;
  passed: number;
  failed: number;
  notChecked: number;
  inputErrors: number;
  errors: number;
  warnings: number;
  strict: boolean;
}

/** Count statuses, errors and warnings across files. */
export function summarize(results: readonly FileResult[], options: JudgeOptions = {}): Summary {
  const summary: Summary = {
    files: results.length,
    passed: 0,
    failed: 0,
    notChecked: 0,
    inputErrors: 0,
    errors: 0,
    warnings: 0,
    strict: options.strict === true,
  };
  for (const result of results) {
    const status = fileStatus(result, options);
    if (status === 'pass') summary.passed++;
    else if (status === 'fail') summary.failed++;
    else if (status === 'not-checked') summary.notChecked++;
    else summary.inputErrors++;
    if ('report' in result) {
      summary.errors += result.report.errors.length;
      summary.warnings += result.report.warnings.length;
    } else {
      summary.errors += 1;
    }
  }
  return summary;
}

/** The process exit code for a set of results: 2 beats 1 beats 0. */
export function exitCode(results: readonly FileResult[], options: JudgeOptions = {}): number {
  const statuses = results.map((r) => fileStatus(r, options));
  if (statuses.includes('input-error')) return EXIT_CODES.INPUT;
  if (statuses.includes('fail')) return EXIT_CODES.ISSUES;
  return EXIT_CODES.OK;
}

/** One file in the JSON output. */
export interface JsonFileOutput {
  file: string;
  status: FileStatus;
  /** Input format that was parsed; absent when the file couldn't be read. */
  format?: 'json' | 'ubl';
  /** Information tier (ca-gst-hst: 1, 2 or 3); absent when no rules ran. */
  tier?: number;
  /** Rule packs that ran. */
  packs: { id: string; version: string }[];
  errors: Issue[];
  warnings: Issue[];
  infos: Issue[];
}

/** The whole `--format json` document. Stable; see docs/json-output.md. */
export interface JsonOutput {
  schemaVersion: typeof JSON_OUTPUT_SCHEMA_VERSION;
  tool: { name: 'invoicelint'; version: string };
  summary: Summary;
  files: JsonFileOutput[];
}

/** Build the `--format json` document for a set of results. */
export function toJsonOutput(
  results: readonly FileResult[],
  version: string,
  options: JudgeOptions = {},
): JsonOutput {
  return {
    schemaVersion: JSON_OUTPUT_SCHEMA_VERSION,
    tool: { name: 'invoicelint', version },
    summary: summarize(results, options),
    files: results.map((result) => {
      const status = fileStatus(result, options);
      if ('inputError' in result) {
        return {
          file: result.file,
          status,
          packs: [],
          errors: [result.inputError],
          warnings: [],
          infos: [],
        };
      }
      const { report } = result;
      return {
        file: result.file,
        status,
        ...(report.format === undefined ? {} : { format: report.format }),
        ...(report.tier === undefined ? {} : { tier: report.tier }),
        packs: report.packs,
        errors: report.errors,
        warnings: report.warnings,
        infos: report.infos,
      };
    }),
  };
}
