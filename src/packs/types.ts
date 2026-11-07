/**
 * Rule-pack contract. A pack bundles the rules for one jurisdiction or standard
 * (ca-gst-hst now; US DBNAlliance and EU EN 16931 later) behind one interface,
 * so the engine never needs to know which country it is checking.
 */
import type { Invoice } from '../model.ts';
import type { Issue, Severity } from '../types.ts';

/** Options every pack receives, with defaults already applied. */
export interface EngineOptions {
  /** Allowed rounding difference per tax line, in cents. */
  toleranceCents: number;
  /**
   * Days either side of a tax-rate change during which both the old and the
   * new rate are accepted (with a warning). Used by ca-gst-hst.
   */
  rateTransitionDays: number;
}

/** What every rule's context has. Packs extend it with their own helpers. */
export interface RuleContext {
  invoice: Invoice;
  options: EngineOptions;
  /** Tier, for packs that have tiers. Rules with `appliesFromTier` are skipped below it. */
  tier?: number;
}

/** Rule metadata: everything except the check itself. Also drives docs/rules.md. */
export interface RuleMeta {
  /** Stable ID, e.g. "CA-ITC-010". */
  id: string;
  /** Default severity. A rule may emit a lower severity (e.g. an "info" when it skips). */
  severity: Severity;
  /** Short name of what the rule checks. */
  title: string;
  /** Exact legal source, e.g. "SOR/91-45 s.3(b)(i)". */
  citation: string;
  /** Default fix hint, written for a bookkeeper. */
  fix: string;
  /** Lowest tier the rule applies to. Omit for rules that apply at every tier. */
  appliesFromTier?: number;
}

/** A rule: its metadata plus the check that produces issues. */
export interface Rule<C extends RuleContext = RuleContext> extends RuleMeta {
  check(ctx: C): Issue[];
}

/** What a rule passes to `report()`. Rule ID, citation and defaults are filled in. */
export interface IssueDraft {
  field: string;
  message: string;
  fix?: string;
  severity?: Severity;
}

/**
 * Build a rule from its metadata and a check function. The check calls
 * `report()` once per finding; ruleId, citation, default severity and fix come
 * from the metadata so they can't drift apart.
 */
export function defineRule<C extends RuleContext>(
  meta: RuleMeta,
  check: (ctx: C, report: (draft: IssueDraft) => void) => void,
): Rule<C> {
  return {
    ...meta,
    check(ctx: C): Issue[] {
      const issues: Issue[] = [];
      check(ctx, (draft) => {
        issues.push({
          ruleId: meta.id,
          severity: draft.severity ?? meta.severity,
          field: draft.field,
          message: draft.message,
          fix: draft.fix ?? meta.fix,
          citation: meta.citation,
        });
      });
      return issues;
    },
  };
}

/** A set of rules for one jurisdiction or standard, run by the engine. */
export interface RulePack<C extends RuleContext = RuleContext> {
  /** e.g. "ca-gst-hst" */
  id: string;
  version: string;
  title: string;
  /** Whether the pack should run on this invoice when no packs are selected explicitly. */
  appliesTo(invoice: Invoice): boolean;
  /** Build the context the pack's rules receive (tier, helpers, tables, ...). */
  createContext(invoice: Invoice, options: EngineOptions): C;
  rules: readonly Rule<C>[];
}
