/** Tier detection and the context notes that go with it. */
import { defineRule } from '../../types.ts';
import type { CaContext } from '../context.ts';
import { THRESHOLDS_IN_FORCE_FROM, TIER_NEEDS, TIER_PARAGRAPH, TIER_RANGE } from '../tier.ts';

export const tierDetected = defineRule<CaContext>(
  {
    id: 'CA-TIER-001',
    severity: 'info',
    title: 'Which information tier applies',
    citation: 'SOR/91-45 s.3(a), (b), (c)',
    fix: 'No action needed. This tells you which information requirements apply.',
  },
  ({ invoice, tier, money }, report) => {
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
    fix: 'No action needed for claims filed on or after 20 April 2021.',
  },
  ({ date, dateField }, report) => {
    if (date === undefined || date >= THRESHOLDS_IN_FORCE_FROM) return;
    report({
      field: dateField,
      message: `This invoice is dated ${date}, before 20 April 2021. The tier above uses today's $100 and $500 thresholds. If the input tax credit was claimed in a return filed before 20 April 2021, the old $30 and $150 thresholds applied instead.`,
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
  ({ invoice }, report) => {
    if (invoice.currency === 'CAD') return;
    report({
      field: 'currency',
      message: `This invoice is in ${invoice.currency}. The $100 and $500 thresholds are in Canadian dollars, so the tier was worked out as if the amounts were CAD and may be wrong.`,
    });
  },
);
