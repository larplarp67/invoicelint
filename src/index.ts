/**
 * invoicelint public API.
 */
import {
  type ValidationReport,
  parseFailureReport,
  resolveEngineOptions,
  runPacks,
} from './engine.ts';
import { BUILTIN_PACKS, resolvePacks } from './packs/index.ts';
import type { RulePack } from './packs/types.ts';
import { parseJsonInvoice } from './parsers/json.ts';

export const VERSION = '0.0.0';

export interface ValidateOptions {
  /** Input format. Only "json" for now; "ubl" arrives with the UBL parser. */
  format?: 'json';
  /**
   * Packs to run, by ID or as pack objects. When given, these packs run even if
   * their `appliesTo()` says no. Default: every built-in pack that applies.
   */
  packs?: readonly (string | RulePack)[];
  /** Allowed rounding difference per tax line, in cents. Default 1. */
  toleranceCents?: number;
}

/**
 * Validate an invoice and return a report. Never throws on bad invoice data;
 * throws only on programmer errors (unknown pack ID, bad option values,
 * wrong argument types).
 */
export function validate(input: string | object, options: ValidateOptions = {}): ValidationReport {
  // Typed as string: plain-JS callers can pass anything.
  const format: string = options.format ?? 'json';
  if (format !== 'json') throw new RangeError(`Unsupported format "${format}"`);
  const engineOptions = resolveEngineOptions(
    options.toleranceCents === undefined ? {} : { toleranceCents: options.toleranceCents },
  );
  const packs = options.packs ? resolvePacks(options.packs) : BUILTIN_PACKS;

  const parsed = parseJsonInvoice(input);
  if (!parsed.ok) return parseFailureReport(parsed.parseErrors);
  return runPacks(parsed.invoice, packs, engineOptions, options.packs !== undefined);
}

export * from './model.ts';
export {
  type Cents,
  type ParseResult,
  type Rounding,
  decimalToScaled,
  formatMoney,
  multiplyCents,
  parseDecimal,
  parseMoney,
  percentOf,
} from './money.ts';
export type { Issue, Severity } from './types.ts';
export { PARSE, type JsonParseResult, formatPath, parseJsonInvoice } from './parsers/json.ts';
export {
  type ValidationReport,
  DEFAULT_ENGINE_OPTIONS,
  runPacks,
  parseFailureReport,
} from './engine.ts';
export {
  type EngineOptions,
  type IssueDraft,
  type Rule,
  type RuleContext,
  type RuleMeta,
  type RulePack,
  defineRule,
} from './packs/types.ts';
export { BUILTIN_PACKS, resolvePacks } from './packs/index.ts';
export {
  GST_HST_PROGRAM,
  type RegistrationNumberResult,
  type RegistrationProblem,
  luhnValid,
  normalize as normalizeRegistrationNumber,
  validateRegistrationNumber,
} from './packs/ca-gst-hst/bn.ts';
export { type CaContext, caGstHstPack } from './packs/ca-gst-hst/index.ts';
export {
  COVERAGE_FROM as RATE_COVERAGE_FROM,
  RATES_SOURCE,
  RATE_TABLE,
  type RateEntry,
  type RateType,
  ratesOn,
} from './packs/ca-gst-hst/rates.ts';
export {
  THRESHOLDS_IN_FORCE_FROM,
  TIER2_FROM_CENTS,
  TIER3_FROM_CENTS,
  type Tier,
  computeTier,
} from './packs/ca-gst-hst/tier.ts';
