/**
 * invoicelint public API.
 *
 * `validate()` arrives with the engine in a later phase.
 */
export const VERSION = '0.0.0';

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
