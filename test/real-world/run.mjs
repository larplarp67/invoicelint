import { readFileSync } from "node:fs";
import { validate } from "invoicelint";
const exp = JSON.parse(readFileSync("expected.json", "utf8"));
let pass = 0; const rows = [];
for (const c of exp) {
  const r = await validate(readFileSync(`invoices/${c.file}`, "utf8"));
  const got = [...r.errors, ...r.warnings].map(i => i.ruleId).sort();
  const want = [...c.expect].sort();
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  const infos = (r.info ?? r.infos ?? []).map(i => i.ruleId);
  rows.push({ file: c.file, ok, want: want.join(",") || "-", got: got.join(",") || "-", tier: r.tier, reportOk: r.ok });
}
console.table(rows);
console.log(`${pass}/${exp.length} match the hand-checked expectation`);
