/**
 * Runs rule packs over a parsed invoice and collects the findings.
 */
import type { Invoice } from './model.ts';
import type { EngineOptions, RulePack } from './packs/types.ts';
import type { Issue } from './types.ts';

/** The result of validating one invoice. */
export interface ValidationReport {
  /** True when there are no errors. Warnings and infos don't fail a report. */
  ok: boolean;
  /** Tier computed by the first pack that has tiers (ca-gst-hst: 1, 2 or 3). */
  tier?: number;
  /** Input format that was parsed. */
  format?: 'json' | 'ubl';
  /** Packs that ran. */
  packs: { id: string; version: string }[];
  /** Wrong data: bad registration number, math that doesn't add up, impossible rate, parse errors. */
  errors: Issue[];
  /** Information missing from this document (it may exist in other documents). */
  warnings: Issue[];
  /** Context: tier detected, checks skipped. */
  infos: Issue[];
}

/** Default engine options: 1 cent tolerance per tax line, 60-day rate transition window. */
export const DEFAULT_ENGINE_OPTIONS: EngineOptions = { toleranceCents: 1, rateTransitionDays: 60 };

export function resolveEngineOptions(options: Partial<EngineOptions> = {}): EngineOptions {
  const resolved = { ...DEFAULT_ENGINE_OPTIONS, ...options };
  for (const key of ['toleranceCents', 'rateTransitionDays'] as const) {
    const value = resolved[key];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${key} must be a non-negative integer, got ${String(value)}`);
    }
  }
  return resolved;
}

export function emptyReport(): ValidationReport {
  return { ok: true, packs: [], errors: [], warnings: [], infos: [] };
}

/** Add issues to a report, by severity, and recompute `ok`. Earlier issues stay first. */
export function addIssues(
  report: ValidationReport,
  issues: readonly Issue[],
  prepend = false,
): ValidationReport {
  const bucket = (severity: Issue['severity']) => issues.filter((i) => i.severity === severity);
  const merge = (existing: Issue[], extra: Issue[]) =>
    prepend ? [...extra, ...existing] : [...existing, ...extra];
  const errors = merge(report.errors, bucket('error'));
  return {
    ...report,
    ok: errors.length === 0,
    errors,
    warnings: merge(report.warnings, bucket('warning')),
    infos: merge(report.infos, bucket('info')),
  };
}

/**
 * A report for input that could not be parsed. Usually all errors; a credit
 * note (PARSE-UBL-010) is an info, so that report is `ok` with no packs run.
 */
export function parseFailureReport(parseErrors: Issue[]): ValidationReport {
  return addIssues(emptyReport(), parseErrors);
}

/**
 * Run packs over an invoice.
 *
 * @param explicit When true, every pack runs even if `appliesTo()` says no
 *   (the caller asked for these packs by name).
 */
export function runPacks(
  invoice: Invoice,
  packs: readonly RulePack[],
  options: Partial<EngineOptions> = {},
  explicit = false,
): ValidationReport {
  const resolved = resolveEngineOptions(options);
  const report = emptyReport();

  for (const pack of packs) {
    if (!explicit && !pack.appliesTo(invoice)) continue;
    const ctx = pack.createContext(invoice, resolved);
    report.packs.push({ id: pack.id, version: pack.version });
    if (ctx.tier !== undefined && report.tier === undefined) report.tier = ctx.tier;

    for (const rule of pack.rules) {
      if (
        rule.appliesFromTier !== undefined &&
        ctx.tier !== undefined &&
        ctx.tier < rule.appliesFromTier
      ) {
        continue;
      }
      for (const issue of rule.check(ctx)) {
        if (issue.severity === 'error') report.errors.push(issue);
        else if (issue.severity === 'warning') report.warnings.push(issue);
        else report.infos.push(issue);
      }
    }
  }

  report.ok = report.errors.length === 0;
  return report;
}
