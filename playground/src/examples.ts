/**
 * Invoices for the "Try an example" menu, taken as they are from the
 * real-world test invoices (test/real-world/), so they stay in step with the
 * rules. playground/test/examples.test.ts checks what each one finds.
 */
import cleanTier3 from '../../test/real-world/invoices/03-it-consultant.json?raw';
import plumber from '../../test/real-world/invoices/11-plumber-missing-buyer-terms.json?raw';
import gstTypo from '../../test/real-world/invoices/13-typo-gst-number.json?raw';
import ontarioGst from '../../test/real-world/edge/h-ontario-charging-gst-only.json?raw';
import groceries from '../../test/real-world/edge/g-hst-on-groceries.json?raw';
import ubl from '../../test/real-world/edge/f-ubl.xml?raw';

export interface Example {
  /** Stable id, used as the <option> value. */
  id: string;
  /** What the menu shows. */
  label: string;
  text: string;
}

export const EXAMPLES: readonly Example[] = [
  {
    id: 'clean-tier-3',
    label: 'Clean tier 3 invoice (IT consultant)',
    text: cleanTier3,
  },
  {
    id: 'plumber-missing-buyer-terms',
    label: 'Plumber: no buyer name or payment terms',
    text: plumber,
  },
  {
    id: 'gst-number-typo',
    label: 'GST/HST number with a typo',
    text: gstTypo,
  },
  {
    id: 'ontario-gst-only',
    label: 'Ontario supplier charging GST only',
    text: ontarioGst,
  },
  {
    id: 'hst-on-groceries',
    label: 'HST charged on groceries',
    text: groceries,
  },
  {
    id: 'ubl-xml',
    label: 'UBL XML invoice (Peppol)',
    text: ubl,
  },
];

/** What the editor starts with when the page has no share link. */
export const DEFAULT_EXAMPLE_ID = 'gst-number-typo';

export function exampleById(id: string): Example | undefined {
  return EXAMPLES.find((e) => e.id === id);
}
