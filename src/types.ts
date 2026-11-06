/** Shared result types used by parsers, rule packs and the engine. */

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  /** Stable identifier, e.g. "PARSE-003" or "CA-ITC-001". */
  ruleId: string;
  severity: Severity;
  /** Path of the offending field, e.g. "lines[2].lineTotal". Empty string for the whole document. */
  field: string;
  /** What is wrong, in plain English. */
  message: string;
  /** How to fix it, in plain English. */
  fix?: string;
  /** Legal source, e.g. "SOR/91-45, s. 3(b)(i)". Parse issues have none. */
  citation?: string;
}
