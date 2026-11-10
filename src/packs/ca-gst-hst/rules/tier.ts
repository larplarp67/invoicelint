/** Tier detection, negative totals, and the context notes that go with them. */
import { defineRule } from '../../types.ts';
import { type CaContext, describeTaxDate } from '../context.ts';
import { THRESHOLDS_IN_FORCE_FROM, TIER_NEEDS, TIER_PARAGRAPH, TIER_RANGE } from '../tier.ts';

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export const tierDetected = defineRule<CaContext>(
  {
    id: 'CA-TIER-001',
    severity: 'info',
    title: 'Which information tier applies',
    citation: 'SOR/91-45 s.3(a), (b), (c)',
    appliesFromTier: 1,
    fix: 'No action needed. This tells you which information requirements apply.',
  },
  ({ invoice, tier, money }, report) => {
    if (tier === undefined) return;
    report({
      field: 'total',
      message: `Tier ${tier}: the total of ${money.amount(invoice.total)} including tax is ${TIER_RANGE[tier]}. To support an input tax credit, the documents need ${TIER_NEEDS[tier]} (SOR/91-45 s.3${TIER_PARAGRAPH[tier]}).`,
    });
  },
);

export const thresholdsChanged = defineRule<CaContext>(
  {
    id: 'CA-TIER-002',
    severity: 'info',
    title: 'Invoice predates the 2021 threshold change',
    citation: 'S.C. 2024, c. 15, s. 142(4); ETA s.169(4)',
    appliesFromTier: 1,
    fix: 'No action needed for claims filed on or after 20 April 2021.',
  },
  ({ date, dateField }, report) => {
    if (date === undefined || date >= THRESHOLDS_IN_FORCE_FROM) return;
    report({
      field: dateField,
      message: `${capitalize(describeTaxDate({ date, dateField }))}, before 20 April 2021. The tier above uses today's $100 and $500 thresholds. If the input tax credit was claimed in a return filed before 20 April 2021, the old $30 and $150 thresholds applied instead.`,
    });
  },
);

export const negativeTotal = defineRule<CaContext>(
  {
    id: 'CA-TOTAL-001',
    severity: 'info',
    title: 'Negative total: looks like a refund or credit note, so tier rules are not applied',
    citation: 'ETA s.232(3); SOR/91-44',
    fix: 'If this is a refund or credit, check it by hand against the credit note requirements (SOR/91-44). If it is meant to be an invoice, the total has the wrong sign: ask the supplier for a corrected invoice.',
  },
  ({ invoice, money }, report) => {
    if (invoice.total >= 0) return;
    report({
      field: 'total',
      message: `The total is ${money.amount(invoice.total)}. A negative total looks like a refund or credit note, not an invoice, so the tier rules (what an invoice must show at $100 and $500) weren't applied. Credit notes have their own required information (SOR/91-44), which invoicelint doesn't check yet. The amounts, tax rates and GST/HST number were still checked.`,
    });
  },
);

export const currencyNotCad = defineRule<CaContext>(
  {
    id: 'CA-CUR-001',
    severity: 'warning',
    title: 'Invoice is not in Canadian dollars',
    citation: 'ETA s.159; SOR/91-45 s.3',
    fix: 'Convert the total to Canadian dollars at the exchange rate for the day the tax was payable, then check which tier applies.',
  },
  ({ invoice, tier }, report) => {
    if (invoice.currency === 'CAD') return;
    if (tier === undefined) {
      // No tier (negative total), so the threshold part of the message doesn't apply.
      report({
        field: 'currency',
        message: `This document is in ${invoice.currency}. For GST/HST, amounts in another currency are converted to Canadian dollars.`,
        fix: 'Convert the amounts to Canadian dollars at the exchange rate for the day the tax was payable.',
      });
      return;
    }
    report({
      field: 'currency',
      message: `This invoice is in ${invoice.currency}. The $100 and $500 thresholds are in Canadian dollars, so the tier was worked out as if the amounts were CAD and may be wrong.`,
    });
  },
);
