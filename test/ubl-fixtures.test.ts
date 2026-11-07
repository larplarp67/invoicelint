/**
 * File-based UBL tests.
 *
 * 1. Equivalence: every *.xml next to a *.json fixture must produce exactly the
 *    same ca-gst-hst findings (rule, severity, field, message) as the JSON one.
 *    This is the main correctness test for the UBL parser.
 * 2. European invoices written for this project: parse without errors and give
 *    sensible output (CA-CUR-001, other-tax notes, no false math or BN errors).
 * 3. UBL edge cases.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validate } from '../src/index.ts';
import type { Invoice } from '../src/model.ts';
import { parseJsonInvoice } from '../src/parsers/json.ts';
import { parseUblInvoice } from '../src/parsers/ubl.ts';
import type { ValidationReport } from '../src/engine.ts';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const read = (...parts: string[]) => readFileSync(join(FIXTURES, ...parts), 'utf8');
const caIssues = (r: ValidationReport) =>
  [...r.errors, ...r.warnings, ...r.infos]
    .filter((i) => i.ruleId.startsWith('CA-'))
    .map((i) => `${i.ruleId} ${i.severity} ${i.field} :: ${i.message}`)
    .sort();
const ids = (r: ValidationReport, severity?: 'error' | 'warning' | 'info') =>
  [
    ...new Set(
      [...r.errors, ...r.warnings, ...r.infos]
        .filter((i) => !severity || i.severity === severity)
        .map((i) => i.ruleId),
    ),
  ].sort();

/**
 * The fields the rules read. Left out: address, quantity and unit price (the
 * twins add them) and invoiceNumber (mandatory in UBL, so a twin of a JSON
 * fixture without one gets a placeholder; no rule reads it).
 */
function projection(inv: Invoice) {
  return {
    issueDate: inv.issueDate,
    currency: inv.currency,
    supplier: {
      name: inv.supplier.name,
      gstHstNumber: inv.supplier.gstHstNumber,
      province: inv.supplier.province,
    },
    buyer: inv.buyer,
    paymentTerms: inv.paymentTerms,
    lines: inv.lines.map((l) => ({
      description: l.description,
      lineTotal: l.lineTotal,
      taxStatus: l.taxStatus,
    })),
    taxes: inv.taxes,
    subtotal: inv.subtotal,
    allowanceTotal: inv.allowanceTotal,
    chargeTotal: inv.chargeTotal,
    total: inv.total,
  };
}

/** JSON fixtures that can't have a UBL twin, and why. */
const NO_UBL_TWIN: Record<string, string> = {
  '13-tax-included-no-rate': 'UBL has no "tax included" statement element',
  '18-no-date': 'cbc:IssueDate is mandatory in UBL (its absence is PARSE-UBL-031)',
  'intermediary-named-supplier-number-shown': 'UBL has no s.3 intermediary element',
};

const pairs = (['valid', 'invalid'] as const).flatMap((dir) =>
  readdirSync(join(FIXTURES, dir))
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ dir, name: f.replace(/\.json$/, '') })),
);

describe('UBL ↔ JSON equivalence', () => {
  const withTwin = pairs.filter((p) => existsSync(join(FIXTURES, p.dir, `${p.name}.xml`)));

  it('covers all three valid tiers and at least 8 invalid cases', () => {
    const names = withTwin.map((p) => p.name);
    for (const tier of ['tier1-ab-receipt-45', 'tier2-on-invoice-250', 'tier3-bc-invoice-1200']) {
      expect(names).toContain(tier);
    }
    expect(withTwin.filter((p) => p.dir === 'invalid').length).toBeGreaterThanOrEqual(8);
  });

  it('every JSON fixture has a UBL twin or a documented reason why not', () => {
    const missing = pairs
      .filter((p) => !existsSync(join(FIXTURES, p.dir, `${p.name}.xml`)))
      .map((p) => p.name)
      .filter((n) => !(n in NO_UBL_TWIN));
    expect(missing).toEqual([]);
  });

  it.each(withTwin.map((p) => [`${p.dir}/${p.name}`, p] as const))('%s', (_label, p) => {
    const fromJson = validate(read(p.dir, `${p.name}.json`));
    const fromUbl = validate(read(p.dir, `${p.name}.xml`));
    expect(fromJson.format).toBe('json');
    expect(fromUbl.format).toBe('ubl');
    // The UBL parser itself must not report errors on these.
    expect(fromUbl.errors.filter((i) => i.ruleId.startsWith('PARSE'))).toEqual([]);
    expect(fromUbl.tier).toBe(fromJson.tier);
    expect(fromUbl.ok).toBe(fromJson.ok);
    expect(caIssues(fromUbl)).toEqual(caIssues(fromJson));

    // Same rule output could hide a mapping difference no rule happens to see
    // (e.g. PST mapped as OTHER), so also compare what the parsers produced.
    const json = parseJsonInvoice(read(p.dir, `${p.name}.json`));
    const ubl = parseUblInvoice(read(p.dir, `${p.name}.xml`));
    if (!json.ok || !ubl.ok) throw new Error('both twins must parse');
    expect(ubl.issues, 'Canadian twins should need no parser notes').toEqual([]);
    expect(projection(ubl.invoice)).toEqual(projection(json.invoice));
  });
});

describe('European invoices (written for this project)', () => {
  it('German invoice: two VAT rates, allowance and charge, default namespaces', () => {
    const r = validate(read('eu', 'de-vat-19-7-allowance-charge.xml'));
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(ids(r, 'warning')).toEqual(['CA-CUR-001', 'CA-ITC-010', 'CA-ITC-011']);
    expect(ids(r, 'info')).toEqual(expect.arrayContaining(['PARSE-UBL-021', 'PARSE-UBL-022']));
    // No false math errors: allowance and charge are accounted for.
    expect(ids(r).filter((id) => id.startsWith('CA-MATH') || id.startsWith('CA-BN'))).toEqual([]);
  });

  it('Swedish invoice: 25%/12% VAT, reverse-charge line, VAT also in EUR', () => {
    const r = validate(read('eu', 'se-vat-25-12-reverse-charge.xml'));
    expect(r.errors).toEqual([]);
    expect(ids(r, 'warning')).toEqual(['CA-CUR-001', 'CA-ITC-010', 'CA-ITC-011']);
    expect(ids(r, 'info')).toEqual(expect.arrayContaining(['PARSE-UBL-020', 'PARSE-UBL-021']));
    expect(r.tier).toBe(3);
  });

  it('French credit note: recognized, not crashed on', () => {
    const r = validate(read('eu', 'fr-credit-note.xml'));
    expect(r).toMatchObject({ ok: true, packs: [], format: 'ubl' });
    expect(ids(r)).toEqual(['PARSE-UBL-010']);
  });
});

describe('UBL edge cases', () => {
  const tier2 = validate(read('valid', 'tier2-on-invoice-250.xml'));

  it.each(['default-namespace', 'odd-prefixes', 'bom'])(
    '%s gives the same result as the plain fixture',
    (name) => {
      const r = validate(read('ubl-edge', `${name}.xml`));
      expect(caIssues(r)).toEqual(caIssues(tier2));
      expect(r.ok).toBe(true);
    },
  );

  it('no buyer party: still parsed; fine at tier 2', () => {
    const r = validate(read('ubl-edge', 'no-buyer-party.xml'));
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it('reverse-charge line: PARSE-UBL-020 and the status is left unset', () => {
    const r = validate(read('ubl-edge', 'reverse-charge-line.xml'));
    expect(r.infos.find((i) => i.ruleId === 'PARSE-UBL-020')).toMatchObject({
      field: 'lines[1].taxStatus',
    });
    expect(r.ok).toBe(true);
  });
});

describe('README', () => {
  it('the UBL example in the README is a valid tier-2 invoice with no findings', () => {
    const readme = readFileSync(join(import.meta.dirname, '..', 'README.md'), 'utf8');
    const xml = /```xml\n([\s\S]*?)```/.exec(readme)?.[1];
    expect(xml).toBeDefined();
    const r = validate(xml ?? '');
    expect(r).toMatchObject({ ok: true, format: 'ubl', tier: 2, errors: [], warnings: [] });
    expect(r.infos.filter((i) => i.ruleId.startsWith('PARSE'))).toEqual([]);
  });
});
