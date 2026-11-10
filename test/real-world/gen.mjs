// Generates realistic, fictional Canadian invoices + the hand-checked expected result for each.
import { mkdirSync, writeFileSync } from "node:fs";

// Luhn check digit for an 8-digit base -> valid fictional 9-digit BN
function bn(base8) {
  const d = base8.split("").map(Number);
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    let v = d[7 - i];
    if (i % 2 === 0) { v *= 2; if (v > 9) v -= 9; }
    sum += v;
  }
  return base8 + ((10 - (sum % 10)) % 10);
}
const gst = (base8) => bn(base8) + "RT0001";
const typo = (n) => n.slice(0, 4) + ((+n[4] + 1) % 10) + n.slice(5); // change one digit

const cases = [];
const add = (file, desc, expect, invoice) => cases.push({ file, desc, expect, invoice });

// ---------- CLEAN INVOICES (expect no errors/warnings) ----------
add("01-coffee-receipt.json", "Coffee shop receipt, $14.69, Ontario (tier 1, no GST number needed)", [], {
  invoiceNumber: "R-88123", issueDate: "2026-11-03", supplier: { name: "Bean There Café", province: "ON" },
  lines: [{ description: "Oat latte (large)", lineTotal: "6.50", taxStatus: "taxable" }, { description: "Almond croissant", lineTotal: "6.50", taxStatus: "taxable" }],
  taxes: [{ type: "HST", rate: 13, taxableAmount: "13.00", amount: "1.69" }], subtotal: "13.00", total: "14.69",
});
add("02-freelance-designer.json", "Freelance logo design, $339, Ontario (tier 2)", [], {
  invoiceNumber: "2026-041", issueDate: "2026-10-28", supplier: { name: "Priya Lal Design", gstHstNumber: gst("71234560"), province: "ON" },
  lines: [{ description: "Logo design package (3 concepts, 2 revisions)", lineTotal: "300.00", taxStatus: "taxable" }],
  taxes: [{ type: "HST", rate: 13, taxableAmount: "300.00", amount: "39.00" }], subtotal: "300.00", total: "339.00",
});
add("03-it-consultant.json", "IT consulting, $2,825, Ontario (tier 3, everything present)", [], {
  invoiceNumber: "NS-1107", issueDate: "2026-11-01", supplier: { name: "Northshore IT Consulting Inc.", gstHstNumber: gst("80011223"), province: "ON" },
  buyer: { name: "Grand River Dental Clinic" }, paymentTerms: "Net 30",
  lines: [{ description: "Network setup, 20 hours @ $100/h", quantity: 20, unitPrice: "100.00", lineTotal: "2000.00", taxStatus: "taxable" },
          { description: "Ubiquiti access points (x5)", quantity: 5, unitPrice: "100.00", lineTotal: "500.00", taxStatus: "taxable" }],
  taxes: [{ type: "HST", rate: 13, taxableAmount: "2500.00", amount: "325.00" }], subtotal: "2500.00", total: "2825.00",
});
add("04-alberta-gst.json", "Alberta contractor, GST only, $525 (tier 3)", [], {
  invoiceNumber: "A-552", issueDate: "2026-09-15", supplier: { name: "Bow Valley Renovations Ltd.", gstHstNumber: gst("72010034"), province: "AB" },
  buyer: { name: "Kim Tran" }, paymentTerms: "Due on receipt",
  lines: [{ description: "Drywall repair, basement (labour + materials)", lineTotal: "500.00", taxStatus: "taxable" }],
  taxes: [{ type: "GST", rate: 5, taxableAmount: "500.00", amount: "25.00" }], subtotal: "500.00", total: "525.00",
});
add("05-nova-scotia-14.json", "Nova Scotia at the new 14% HST, dated 2026 (tier 2)", [], {
  invoiceNumber: "HFX-90", issueDate: "2026-10-05", supplier: { name: "Harbour Print Shop", gstHstNumber: gst("73300119"), province: "NS" },
  lines: [{ description: "500 business cards, 2-sided", lineTotal: "150.00", taxStatus: "taxable" }],
  taxes: [{ type: "HST", rate: 14, taxableAmount: "150.00", amount: "21.00" }], subtotal: "150.00", total: "171.00",
});
add("06-bc-gst-pst.json", "BC bike shop, GST 5% + PST 7%, $112 (tier 2)", [], {
  invoiceNumber: "V-3301", issueDate: "2026-08-20", supplier: { name: "Commercial Drive Cycles", gstHstNumber: gst("74455667"), province: "BC" },
  lines: [{ description: "Tune-up, full service", lineTotal: "100.00", taxStatus: "taxable" }],
  taxes: [{ type: "GST", rate: 5, taxableAmount: "100.00", amount: "5.00" }, { type: "PST", rate: 7, taxableAmount: "100.00", amount: "7.00" }],
  subtotal: "100.00", total: "112.00",
});
add("07-quebec-gst-qst.json", "Quebec translator, GST + QST (9.975%), $574.88 (tier 3)", [], {
  invoiceNumber: "MTL-2026-17", issueDate: "2026-07-02", supplier: { name: "Traductions Lefebvre", gstHstNumber: gst("75566778"), province: "QC" },
  buyer: { name: "Maple Leaf Games Inc." }, paymentTerms: "Net 15",
  lines: [{ description: "French translation of game UI strings (4,000 words)", lineTotal: "500.00", taxStatus: "taxable" }],
  taxes: [{ type: "GST", rate: 5, taxableAmount: "500.00", amount: "25.00" }, { type: "QST", rate: 9.975, taxableAmount: "500.00", amount: "49.88" }],
  subtotal: "500.00", total: "574.88",
});
add("08-restaurant-tax-included.json", "Restaurant bill, 'total includes HST 13%', $120 (tier 2)", [], {
  invoiceNumber: "T12-4471", issueDate: "2026-10-31", supplier: { name: "The Lazy Walrus Pub", gstHstNumber: gst("76677889"), province: "ON" },
  lines: [{ description: "Team lunch (6 people)", lineTotal: "120.00", taxStatus: "taxable" }],
  taxIncludedStatement: { included: true, rate: 13 }, total: "120.00",
});
add("09-grocery-mixed-stated.json", "Grocery order: zero-rated food + taxable items, statuses stated, $166.50 (tier 2)", [], {
  invoiceNumber: "G-77810", issueDate: "2026-11-02", supplier: { name: "FreshCart Grocers", gstHstNumber: gst("77788990"), province: "ON" },
  lines: [{ description: "Basic groceries (produce, dairy, bread)", lineTotal: "110.00", taxStatus: "zero-rated" },
          { description: "Paper towels and dish soap", lineTotal: "30.00", taxStatus: "taxable" },
          { description: "Sparkling water (24 pack)", lineTotal: "20.00", taxStatus: "taxable" }],
  taxes: [{ type: "HST", rate: 13, taxableAmount: "50.00", amount: "6.50" }], subtotal: "160.00", total: "166.50",
});
add("10-marketplace-intermediary.json", "Online marketplace order: seller has no number, marketplace (intermediary) does, $226 (tier 2)", [], {
  invoiceNumber: "MP-114-2299", issueDate: "2026-10-19", supplier: { name: "Gadget Garage (third-party seller)" },
  intermediary: { name: "ShopNorth Marketplace Inc.", gstHstNumber: gst("78899001") },
  lines: [{ description: "USB-C docking station", lineTotal: "200.00", taxStatus: "taxable" }],
  taxes: [{ type: "HST", rate: 13, taxableAmount: "200.00", amount: "26.00" }], subtotal: "200.00", total: "226.00",
});

// ---------- COMMON REAL-WORLD MISTAKES ----------
add("11-plumber-missing-buyer-terms.json", "Plumber, $678, forgot buyer name and payment terms (tier 3)", ["CA-ITC-020", "CA-ITC-021"], {
  invoiceNumber: "P-101", issueDate: "2026-10-10", supplier: { name: "Dave's Plumbing", gstHstNumber: gst("79900112"), province: "ON" },
  lines: [{ description: "Replace hot water tank valve + 3h labour", lineTotal: "600.00", taxStatus: "taxable" }],
  taxes: [{ type: "HST", rate: 13, taxableAmount: "600.00", amount: "78.00" }], subtotal: "600.00", total: "678.00",
});
add("12-landscaper-bare-bn.json", "Landscaper shows only the 9-digit Business Number, $226 (tier 2)", ["CA-BN-003"], {
  invoiceNumber: "L-44", issueDate: "2026-06-12", supplier: { name: "Green Thumb Landscaping", gstHstNumber: bn("81122334"), province: "ON" },
  lines: [{ description: "Spring cleanup and mulch", lineTotal: "200.00", taxStatus: "taxable" }],
  taxes: [{ type: "HST", rate: 13, taxableAmount: "200.00", amount: "26.00" }], subtotal: "200.00", total: "226.00",
});
add("13-typo-gst-number.json", "Tutor's GST/HST number has a one-digit typo, $169.50 (tier 2)", ["CA-BN-001"], {
  invoiceNumber: "TUT-9", issueDate: "2026-09-30", supplier: { name: "Math Mentors Waterloo", gstHstNumber: typo(gst("82233445")), province: "ON" },
  lines: [{ description: "Calculus tutoring, 3 sessions", lineTotal: "150.00", taxStatus: "taxable" }],
  taxes: [{ type: "HST", rate: 13, taxableAmount: "150.00", amount: "19.50" }], subtotal: "150.00", total: "169.50",
});
add("14-wrong-program-rp.json", "Supplier printed their payroll account (RP) instead of GST/HST (RT), $113 (tier 2)", ["CA-BN-002"], {
  invoiceNumber: "C-210", issueDate: "2026-05-05", supplier: { name: "CleanSweep Office Cleaning", gstHstNumber: bn("83344556") + "RP0001", province: "ON" },
  lines: [{ description: "Office cleaning, May", lineTotal: "100.00", taxStatus: "taxable" }],
  taxes: [{ type: "HST", rate: 13, taxableAmount: "100.00", amount: "13.00" }], subtotal: "100.00", total: "113.00",
});
add("15-crosses-100-no-number.json", "$99 + 13% HST = $111.87, no GST/HST number (tax pushes it into tier 2)", ["CA-ITC-010"], {
  invoiceNumber: "K-3", issueDate: "2026-11-04", supplier: { name: "Keystone Locksmith", province: "ON" },
  lines: [{ description: "Rekey front door lock", lineTotal: "99.00", taxStatus: "taxable" }],
  taxes: [{ type: "HST", rate: 13, taxableAmount: "99.00", amount: "12.87" }], subtotal: "99.00", total: "111.87",
});
add("16-total-wrong.json", "Caterer's total doesn't add up (typed $462 instead of $452)", ["CA-MATH-002"], {
  invoiceNumber: "CAT-58", issueDate: "2026-10-22", supplier: { name: "Two Forks Catering", gstHstNumber: gst("84455667"), province: "ON" },
  lines: [{ description: "Sandwich platters (x4)", lineTotal: "400.00", taxStatus: "taxable" }],
  taxes: [{ type: "HST", rate: 13, taxableAmount: "400.00", amount: "52.00" }], subtotal: "400.00", total: "462.00",
});
add("17-lines-dont-sum.json", "Lines add to $350 but subtotal says $360", ["CA-MATH-001"], {
  invoiceNumber: "W-12", issueDate: "2026-10-01", supplier: { name: "Pixel Pushers Web", gstHstNumber: gst("85566778"), province: "ON" },
  lines: [{ description: "Landing page", lineTotal: "250.00", taxStatus: "taxable" }, { description: "Hosting setup", lineTotal: "100.00", taxStatus: "taxable" }],
  taxes: [{ type: "HST", rate: 13, taxableAmount: "360.00", amount: "46.80" }], subtotal: "360.00", total: "406.80",
});
add("18-tax-miscalculated.json", "HST shown as $15.00 on $100 (should be $13.00)", ["CA-MATH-003"], {
  invoiceNumber: "Q-7", issueDate: "2026-08-08", supplier: { name: "QuickFix Phone Repair", gstHstNumber: gst("86677889"), province: "ON" },
  lines: [{ description: "iPhone screen replacement", lineTotal: "100.00", taxStatus: "taxable" }],
  taxes: [{ type: "HST", rate: 13, taxableAmount: "100.00", amount: "15.00" }], subtotal: "100.00", total: "115.00",
});
add("19-old-gst-7.json", "Template still charges the old 7% GST (Alberta)", ["CA-RATE-001"], {
  invoiceNumber: "OLD-1", issueDate: "2026-04-14", supplier: { name: "Prairie Sign Co.", gstHstNumber: gst("87788990"), province: "AB" },
  lines: [{ description: "Vinyl storefront sign", lineTotal: "200.00", taxStatus: "taxable" }],
  taxes: [{ type: "GST", rate: 7, taxableAmount: "200.00", amount: "14.00" }], subtotal: "200.00", total: "214.00",
});
add("20-ns-14-too-early.json", "14% HST dated Feb 2025, before Nova Scotia's rate cut (no province had 14% then)", ["CA-RATE-002"], {
  invoiceNumber: "NS-EARLY", issueDate: "2025-02-01", supplier: { name: "Lunenburg Marine Supply", gstHstNumber: gst("88899001"), province: "NS" },
  lines: [{ description: "Boat cover", lineTotal: "300.00", taxStatus: "taxable" }],
  taxes: [{ type: "HST", rate: 14, taxableAmount: "300.00", amount: "42.00" }], subtotal: "300.00", total: "342.00",
});
add("21-usd-saas.json", "Canadian SaaS bills in USD", ["CA-CUR-001"], {
  invoiceNumber: "INV-0001942", issueDate: "2026-11-01", currency: "USD", supplier: { name: "Loopwise Analytics Inc.", gstHstNumber: gst("89900112"), province: "ON" },
  lines: [{ description: "Pro plan, monthly", lineTotal: "49.00", taxStatus: "taxable" }],
  taxes: [{ type: "HST", rate: 13, taxableAmount: "49.00", amount: "6.37" }], subtotal: "49.00", total: "55.37",
});
add("22-tax-on-exempt.json", "Tax charged on exempt services (residential rent)", ["CA-MATH-004"], {
  invoiceNumber: "RENT-11", issueDate: "2026-11-01", supplier: { name: "Laurier Properties", gstHstNumber: gst("90011223"), province: "ON" },
  lines: [{ description: "Residential rent, November, unit 4B", lineTotal: "1200.00", taxStatus: "exempt" }],
  taxes: [{ type: "HST", rate: 13, taxableAmount: "1200.00", amount: "156.00" }], subtotal: "1200.00", total: "1356.00",
  buyer: { name: "Jordan Lee" }, paymentTerms: "Due on the 1st",
});
add("23-vague-descriptions.json", "$904 invoice with descriptions 'services' and 'x' (tier 3)", ["CA-ITC-022"], {
  invoiceNumber: "V-1", issueDate: "2026-09-09", supplier: { name: "Vague Ventures Consulting", gstHstNumber: gst("91122334"), province: "ON" },
  buyer: { name: "Riverbend Bakery" }, paymentTerms: "Net 30",
  lines: [{ description: "services", lineTotal: "700.00", taxStatus: "taxable" }, { description: "x", lineTotal: "100.00", taxStatus: "taxable" }],
  taxes: [{ type: "HST", rate: 13, taxableAmount: "800.00", amount: "104.00" }], subtotal: "800.00", total: "904.00",
});
add("24-mixed-status-unstated.json", "Pharmacy: exempt prescription + taxable items, taxable lines don't say so ($254)", ["CA-ITC-013"], {
  invoiceNumber: "RX-5521", issueDate: "2026-10-27", supplier: { name: "Uptown Pharmacy", gstHstNumber: gst("92233445"), province: "ON" },
  lines: [{ description: "Prescription (amoxicillin)", lineTotal: "54.00", taxStatus: "zero-rated" }, { description: "Electric toothbrush" , lineTotal: "200.00" }],
  taxes: [{ type: "HST", rate: 13, taxableAmount: "200.00", amount: "26.00" }], subtotal: "254.00", total: "280.00",
});
add("25-no-date.json", "Handwritten-style receipt with no date at all ($45.20)", ["CA-ITC-002"], {
  invoiceNumber: "0042", supplier: { name: "Farmers Market Woodworks", province: "ON" },
  lines: [{ description: "Maple cutting board", lineTotal: "40.00", taxStatus: "taxable" }],
  taxes: [{ type: "HST", rate: 13, taxableAmount: "40.00", amount: "5.20" }], subtotal: "40.00", total: "45.20",
});
add("26-tax-included-no-rate.json", "'Taxes included' with no rate stated ($300)", ["CA-ITC-012"], {
  invoiceNumber: "SPA-8", issueDate: "2026-10-15", supplier: { name: "Stillwater Massage Therapy", gstHstNumber: gst("93344556"), province: "ON" },
  lines: [{ description: "Massage therapy package (3 x 60 min)", lineTotal: "300.00", taxStatus: "taxable" }],
  taxIncludedStatement: { included: true }, total: "300.00",
});
add("27-no-tax-shown.json", "$250 invoice with no tax line and no 'tax included' statement", ["CA-ITC-011"], {
  invoiceNumber: "PH-3", issueDate: "2026-10-03", supplier: { name: "Silver Frame Photography", gstHstNumber: gst("94455667"), province: "ON" },
  lines: [{ description: "Headshot session + 5 edited photos", lineTotal: "250.00", taxStatus: "taxable" }],
  total: "250.00",
});

// ---------- TRICKY EDGE CASES ----------
add("28-rounding-1-cent.json", "HST on $99.99 is $12.9987 → $13.00; invoice shows $12.99 (1 cent off, within default tolerance)", [], {
  invoiceNumber: "E-1", issueDate: "2026-10-12", supplier: { name: "Edge Case Electronics", gstHstNumber: gst("95566778"), province: "ON" },
  lines: [{ description: "Bluetooth speaker", lineTotal: "99.99", taxStatus: "taxable" }],
  taxes: [{ type: "HST", rate: 13, taxableAmount: "99.99", amount: "12.99" }], subtotal: "99.99", total: "112.98",
});
add("29-ns-15-in-2026.json", "Nova Scotia supplier still charging old 15% in 2026 (KNOWN LIMITATION: 15% is valid in NB/NL/PE, and the tool doesn't determine place of supply)", [], {
  invoiceNumber: "NS-LATE", issueDate: "2026-09-01", supplier: { name: "Dartmouth Auto Detailing", gstHstNumber: gst("96677889"), province: "NS" },
  lines: [{ description: "Full interior detail", lineTotal: "200.00", taxStatus: "taxable" }],
  taxes: [{ type: "HST", rate: 15, taxableAmount: "200.00", amount: "30.00" }], subtotal: "200.00", total: "230.00",
});
add("30-near-rate-change.json", "HST 15% dated 2025-04-10, ten days after NS's cut (inside the transition window)", [], {
  invoiceNumber: "NS-TRANS", issueDate: "2025-04-10", supplier: { name: "Bluenose Bookkeeping", gstHstNumber: gst("97788990"), province: "NS" },
  lines: [{ description: "Q1 bookkeeping", lineTotal: "200.00", taxStatus: "taxable" }],
  taxes: [{ type: "HST", rate: 15, taxableAmount: "200.00", amount: "30.00" }], subtotal: "200.00", total: "230.00",
});

mkdirSync("invoices", { recursive: true });
for (const c of cases) writeFileSync(`invoices/${c.file}`, JSON.stringify(c.invoice, null, 2));
writeFileSync("expected.json", JSON.stringify(cases.map(({ file, desc, expect }) => ({ file, desc, expect })), null, 2));
console.log(`wrote ${cases.length} invoices`);
