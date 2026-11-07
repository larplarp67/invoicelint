/**
 * invoicelint public API.
 */
import {
  type ValidationReport,
  addIssues,
  parseFailureReport,
  resolveEngineOptions,
  runPacks,
} from './engine.ts';
import { BUILTIN_PACKS, resolvePacks } from './packs/index.ts';
import type { RulePack } from './packs/types.ts';
import { parseJsonInvoice } from './parsers/json.ts';
import { parseUblInvoice } from './parsers/ubl.ts';
import { DEFAULT_MAX_XML_BYTES } from './parsers/xml.ts';

/** Keep in step with package.json; test/smoke.test.ts fails if they differ. */
export const VERSION = '0.1.0';

export type InputFormat = 'json' | 'ubl';

export interface ValidateOptions {
  /**
   * Input format. "auto" (default): a string starting with "<" (after
   * whitespace and a byte-order mark) is UBL XML, anything else is JSON.
   */
  format?: InputFormat | 'auto';
  /** Maximum size of an XML input in bytes. Default 5 MB. */
  maxXmlBytes?: number;
  /**
   * Packs to run, by ID or as pack objects. When given, these packs run even if
   * their `appliesTo()` says no. Default: every built-in pack that applies.
   */
  packs?: readonly (string | RulePack)[];
  /** Allowed rounding difference per tax line, in cents. Default 1. */
  toleranceCents?: number;
  /**
   * Days either side of a GST/HST rate change in which the old and the new
   * rate are both accepted, with a warning. Default 60.
   */
  rateTransitionDays?: number;
}

/**
 * Validate an invoice and return a report. Never throws on bad invoice data;
 * throws only on programmer errors (unknown pack ID, bad option values,
 * wrong argument types).
 */
/** Guess the input format: XML if a string starts with "<" (after whitespace / BOM). */
export function detectFormat(input: string | object): InputFormat {
  return typeof input === 'string' && /^\uFEFF?\s*</.test(input) ? 'ubl' : 'json';
}

export function validate(input: string | object, options: ValidateOptions = {}): ValidationReport {
  // Typed as string: plain-JS callers can pass anything.
  const requested: string = options.format ?? 'auto';
  if (requested !== 'auto' && requested !== 'json' && requested !== 'ubl') {
    throw new RangeError(`Unsupported format "${requested}". Use "auto", "json" or "ubl".`);
  }
  const format: InputFormat = requested === 'auto' ? detectFormat(input) : requested;
  if (format === 'ubl' && typeof input !== 'string') {
    throw new TypeError('UBL input must be an XML string.');
  }
  const engineOptions = resolveEngineOptions({
    ...(options.toleranceCents === undefined ? {} : { toleranceCents: options.toleranceCents }),
    ...(options.rateTransitionDays === undefined
      ? {}
      : { rateTransitionDays: options.rateTransitionDays }),
  });
  const packs = options.packs ? resolvePacks(options.packs) : BUILTIN_PACKS;

  const parsed =
    format === 'ubl'
      ? parseUblInvoice(input as string, { maxBytes: options.maxXmlBytes ?? DEFAULT_MAX_XML_BYTES })
      : parseJsonInvoice(input);
  if (!parsed.ok) return { ...parseFailureReport(parsed.parseErrors), format };
  const report = runPacks(parsed.invoice, packs, engineOptions, options.packs !== undefined);
  return { ...addIssues(report, parsed.issues, true), format };
}

export { type DecodeResult, decodeInvoiceBytes } from './decode.ts';
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
  UBL_ISSUES,
  UBL_NS,
  type UblOptions,
  type UblParseResult,
  normalizeProvince,
  parseUblInvoice,
} from './parsers/ubl.ts';
export { DEFAULT_MAX_XML_BYTES, XML_ISSUES } from './parsers/xml.ts';
export {
  type ValidationReport,
  DEFAULT_ENGINE_OPTIONS,
  addIssues,
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
