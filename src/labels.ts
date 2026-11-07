/**
 * Plain-English labels for issue field paths, for people reading the output:
 * "taxes[0].rate" -> "Tax line 1 rate", "supplier.gstHstNumber" ->
 * "Supplier GST/HST number". Browser-safe.
 */

const ROOT: Record<string, string> = {
  invoiceNumber: 'Invoice number',
  issueDate: 'Invoice date',
  taxPaidDate: 'Date tax was paid',
  currency: 'Currency',
  supplier: 'Supplier',
  intermediary: 'Intermediary',
  buyer: 'Buyer',
  lines: 'Lines',
  taxes: 'Taxes',
  taxIncludedStatement: 'Tax-included statement',
  subtotal: 'Subtotal',
  allowanceTotal: 'Allowances',
  chargeTotal: 'Charges',
  total: 'Total',
  paymentTerms: 'Payment terms',
};

const LEAF: Record<string, string> = {
  name: 'name',
  tradingName: 'trading name',
  gstHstNumber: 'GST/HST number',
  province: 'province',
  address: 'address',
  description: 'description',
  quantity: 'quantity',
  unitPrice: 'unit price',
  lineTotal: 'amount',
  taxStatus: 'tax status',
  type: 'type',
  rate: 'rate',
  taxableAmount: 'amount taxed',
  amount: 'amount',
  included: '',
};

const INDEXED: Record<string, string> = { lines: 'Line', taxes: 'Tax line' };

/** Turn an issue field path into a short label. Unknown paths are returned unchanged. */
export function fieldLabel(path: string): string {
  if (path === '') return '';
  const m = /^(\w+)(?:\[(\d+)\])?(?:\.(\w+))?$/.exec(path);
  if (!m) return path;
  const [, root = '', index, leaf] = m;
  const head =
    index !== undefined && INDEXED[root] !== undefined
      ? `${INDEXED[root]} ${Number(index) + 1}`
      : ROOT[root];
  if (head === undefined) return path;
  if (leaf === undefined) return head;
  const tail = LEAF[leaf];
  if (tail === undefined) return path;
  return tail === '' ? head : `${head} ${tail}`;
}
