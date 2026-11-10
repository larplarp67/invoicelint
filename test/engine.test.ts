import { describe, expect, it } from 'vitest';
import { runPacks } from '../src/engine.ts';
import { validate } from '../src/index.ts';
import { InvoiceSchema } from '../src/model.ts';
import { type RuleContext, type RulePack, defineRule } from '../src/packs/types.ts';

const invoice = InvoiceSchema.parse({ total: '250.00', currency: 'CAD' });

interface TestContext extends RuleContext {
  tier: number;
}

/** A tiny pack that exercises every engine path. */
function testPack(overrides: Partial<RulePack<TestContext>> = {}): RulePack<TestContext> {
  return {
    id: 'test-pack',
    version: '1.0.0',
    title: 'Test pack',
    appliesTo: () => true,
    createContext: (inv, options) => ({ invoice: inv, options, tier: 2 }),
    rules: [
      defineRule<TestContext>(
        { id: 'T-INFO', severity: 'info', title: 'Info', citation: 'none', fix: 'n/a' },
        (_ctx, report) => {
          report({ field: '', message: 'context' });
        },
      ),
      defineRule<TestContext>(
        {
          id: 'T-WARN',
          severity: 'warning',
          title: 'Warn',
          citation: 'cite-w',
          fix: 'fix-w',
          appliesFromTier: 2,
        },
        (_ctx, report) => {
          report({ field: 'buyer.name', message: 'missing' });
        },
      ),
      defineRule<TestContext>(
        {
          id: 'T-TIER3',
          severity: 'warning',
          title: 'Tier 3 only',
          citation: 'c',
          fix: 'f',
          appliesFromTier: 3,
        },
        (_ctx, report) => {
          report({ field: 'x', message: 'should not run at tier 2' });
        },
      ),
      defineRule<TestContext>(
        { id: 'T-ERR', severity: 'error', title: 'Err', citation: 'cite-e', fix: 'fix-e' },
        (ctx, report) => {
          if (ctx.invoice.total > ctx.options.toleranceCents) {
            report({ field: 'total', message: 'bad', fix: 'custom fix' });
            report({ field: 'total', message: 'downgraded', severity: 'info' });
          }
        },
      ),
    ],
    ...overrides,
  };
}

describe('defineRule', () => {
  it('fills ruleId, citation, default severity and default fix', () => {
    const [warn] =
      testPack().rules[1]?.check({
        invoice,
        options: { toleranceCents: 1, rateTransitionDays: 60 },
        tier: 2,
      }) ?? [];
    expect(warn).toEqual({
      ruleId: 'T-WARN',
      severity: 'warning',
      field: 'buyer.name',
      message: 'missing',
      fix: 'fix-w',
      citation: 'cite-w',
    });
  });
});

describe('runPacks', () => {
  it('buckets issues by severity, honours tiers and per-issue overrides', () => {
    const report = runPacks(invoice, [testPack()]);
    expect(report.ok).toBe(false);
    expect(report.tier).toBe(2);
    expect(report.packs).toEqual([{ id: 'test-pack', version: '1.0.0' }]);
    expect(report.errors.map((i) => [i.ruleId, i.fix])).toEqual([['T-ERR', 'custom fix']]);
    expect(report.warnings.map((i) => i.ruleId)).toEqual(['T-WARN']);
    expect(report.infos.map((i) => i.ruleId)).toEqual(['T-INFO', 'T-ERR']);
  });

  it('ok is true when only warnings and infos are present', () => {
    const report = runPacks(invoice, [testPack()], { toleranceCents: 1_000_000 });
    expect(report.errors).toEqual([]);
    expect(report.warnings).toHaveLength(1);
    expect(report.ok).toBe(true);
  });

  it('skips rules with a lowest tier when the context has no tier', () => {
    const noTier: RulePack = {
      ...testPack(),
      createContext: (inv, options) => ({ invoice: inv, options }),
    };
    const report = runPacks(invoice, [noTier]);
    expect(report.tier).toBeUndefined();
    expect(report.warnings).toEqual([]); // T-WARN (tier 2+) and T-TIER3 skipped
    expect(report.errors.map((i) => i.ruleId)).toEqual(['T-ERR']); // rules without a tier run
  });

  it('skips packs whose appliesTo() is false unless selected explicitly', () => {
    const pack = testPack({ appliesTo: () => false });
    expect(runPacks(invoice, [pack]).packs).toEqual([]);
    expect(runPacks(invoice, [pack], {}, true).packs).toHaveLength(1);
  });

  it('rejects a bad tolerance (programmer error)', () => {
    expect(() => runPacks(invoice, [testPack()], { toleranceCents: -1 })).toThrow(RangeError);
    expect(() => runPacks(invoice, [testPack()], { toleranceCents: 0.5 })).toThrow(RangeError);
  });
});

describe('validate', () => {
  it('turns parse errors into a failed report without running packs', () => {
    const report = validate('{"total": "12.345"}', { packs: [testPack()] });
    expect(report.ok).toBe(false);
    expect(report.packs).toEqual([]);
    expect(report.errors.map((i) => i.ruleId)).toEqual(['PARSE-005']);
  });

  it('runs explicitly given pack objects', () => {
    const report = validate({ total: 1 }, { packs: [testPack()], toleranceCents: 100 });
    expect(report.ok).toBe(true);
    expect(report.packs.map((p) => p.id)).toEqual(['test-pack']);
  });

  it('throws on an unknown pack ID', () => {
    expect(() => validate({ total: 1 }, { packs: ['nope'] })).toThrow(/Unknown rule pack "nope"/);
  });
});
