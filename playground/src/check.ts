/**
 * Runs the library on the editor text and works out what the results panel
 * shows. No DOM here, so it can be tested on its own.
 */
import {
  type FileStatus,
  type InputFormat,
  type Tier,
  type ValidationReport,
  UBL_ISSUES,
  detectFormat,
  fileStatus,
  parseJsonInvoice,
  parseUblInvoice,
  validate,
} from '../../src/index.ts';
import { formatAmount } from '../../src/packs/ca-gst-hst/context.ts';
import { TIER_RANGE } from '../../src/packs/ca-gst-hst/tier.ts';

/** The editor has an invoice in it and invoicelint ran on it. */
export interface Checked {
  kind: 'checked';
  format: InputFormat;
  report: ValidationReport;
  status: FileStatus;
  /** The invoice total in its own currency ("$250.00", "1,234.56 SEK"), when the invoice parsed. */
  total?: string;
  /** The invoice currency, when the invoice parsed. */
  currency?: string;
}

/** What the results panel shows. */
export type Outcome =
  | { kind: 'empty' }
  | Checked
  /** validate() threw: a bug in invoicelint, since bad invoice data never throws. */
  | { kind: 'crashed'; message: string };

export type Tone = 'ok' | 'warning' | 'error' | 'muted';

/** The status badge and the sentence under it. */
export interface Headline {
  tone: Tone;
  icon: string;
  title: string;
  detail: string;
}

export const FORMAT_LABEL: Record<InputFormat, string> = { json: 'JSON', ubl: 'UBL XML' };

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Validate the editor text. Whitespace only counts as empty. */
export function checkInvoice(text: string): Outcome {
  if (text.trim() === '') return { kind: 'empty' };
  const format = detectFormat(text);
  let report: ValidationReport;
  try {
    report = validate(text);
  } catch (err) {
    return { kind: 'crashed', message: err instanceof Error ? err.message : String(err) };
  }
  const checked: Checked = {
    kind: 'checked',
    format,
    report,
    status: fileStatus({ file: 'invoice', report }),
  };
  // The report has the tier but not the total, so parse once more for the badge.
  if (report.packs.length > 0) {
    const parsed = format === 'ubl' ? parseUblInvoice(text) : parseJsonInvoice(text);
    if (parsed.ok) {
      checked.total = formatAmount(parsed.invoice.total, parsed.invoice.currency);
      checked.currency = parsed.invoice.currency;
    }
  }
  return checked;
}

/** The status badge: the same judgement as the CLI's status line. */
export function headline(outcome: Checked): Headline {
  const { errors, warnings, infos } = outcome.report;
  switch (outcome.status) {
    case 'input-error':
      return {
        tone: 'error',
        icon: '✗',
        title: "Can't read this invoice",
        detail: `${plural(errors.length, 'input error')}. Fix ${errors.length === 1 ? 'it' : 'them'} and the rules will run.`,
      };
    case 'skipped':
      return {
        tone: 'muted',
        icon: '⊘',
        title: 'Skipped',
        detail: infos.some((i) => i.ruleId === UBL_ISSUES.CREDIT_NOTE)
          ? 'This is a credit note. invoicelint recognizes credit notes but does not check them yet.'
          : 'No rules ran on this document.',
      };
    case 'failed':
      return {
        tone: 'error',
        icon: '✗',
        title:
          warnings.length === 0
            ? plural(errors.length, 'error')
            : `${plural(errors.length, 'error')}, ${plural(warnings.length, 'warning')}`,
        detail: 'Errors mean something on the invoice is wrong.',
      };
    case 'ok':
      return warnings.length > 0
        ? {
            tone: 'warning',
            icon: '⚠',
            title: plural(warnings.length, 'warning'),
            detail:
              'No errors. A warning means information is missing from this document; the law lets it come from other documents.',
          }
        : { tone: 'ok', icon: '✓', title: 'OK', detail: 'No errors or warnings.' };
  }
}

/** The tier badge and its one-line explanation, when rules ran. */
export function tierSummary(outcome: Checked): { badge: string; caption: string } | undefined {
  const { tier } = outcome.report;
  if (outcome.report.packs.length === 0 || outcome.total === undefined) return undefined;
  if (tier === undefined) {
    return {
      badge: `No tier · ${outcome.total}`,
      caption:
        'A negative total looks like a refund or credit note, so the tier rules were not applied.',
    };
  }
  const badge = `Tier ${tier} · ${outcome.total}`;
  if (outcome.currency !== 'CAD') {
    return {
      badge,
      caption: `Tier ${tier} is worked out from the total as written. The thresholds are in Canadian dollars, so convert it to check.`,
    };
  }
  return {
    badge,
    caption: `The total of ${outcome.total} including tax is ${TIER_RANGE[tier as Tier]}, so the tier ${tier} rules apply.`,
  };
}

/** Short text for screen readers when the result changes. */
export function announcement(outcome: Outcome): string {
  if (outcome.kind === 'empty') return 'Editor is empty.';
  if (outcome.kind === 'crashed') return 'invoicelint crashed on this input.';
  const h = headline(outcome);
  return `${h.title}.`;
}
