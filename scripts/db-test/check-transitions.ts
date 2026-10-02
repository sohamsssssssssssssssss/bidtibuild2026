/**
 * 02 §15 "the TS transitions match SQL": compares STATUS_TRANSITIONS (src/config/civic.ts, drives the
 * UI) with `public.status_transition_rules()` (enforced by the write functions), row by row:
 * (from_status, to_status, event_type, stretch). 02 §4 is the source of truth for both.
 *
 * Usage: node scripts/db-test/check-transitions.ts <database url>
 * Runs with Node's built-in type stripping (no build step). Uses psql, so no pg dependency.
 * Exits 1 and prints the difference when the two disagree.
 */
import { execFileSync } from "node:child_process";
import { STATUS_TRANSITIONS } from "../../src/config/civic.ts";

const dbUrl = process.argv[2];
if (!dbUrl) {
  console.error("usage: node scripts/db-test/check-transitions.ts <database url>");
  process.exit(2);
}

const key = (from: string, to: string, event: string, stretch: boolean) => `${from} -> ${to} [${event}${stretch ? ", stretch" : ""}]`;

// TS: one row per from-status.
const ts = new Set<string>();
for (const t of STATUS_TRANSITIONS) {
  for (const from of t.from) ts.add(key(from, t.to, t.event, t.stretch));
}

// SQL
const out = execFileSync(
  "psql",
  ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-AtF,", dbUrl, "-c",
   "select from_status, to_status, event_type, stretch from public.status_transition_rules()"],
  { encoding: "utf8" },
);
const sqlRows = out.split("\n").filter((l) => l.trim() !== "");
const sql = new Set<string>();
for (const line of sqlRows) {
  const [from = "", to = "", event = "", stretch = ""] = line.split(",");
  sql.add(key(from, to, event, stretch === "t"));
}

const onlyTs = [...ts].filter((k) => !sql.has(k)).sort();
const onlySql = [...sql].filter((k) => !ts.has(k)).sort();
const duplicates = sqlRows.length - sql.size;

if (onlyTs.length || onlySql.length || duplicates) {
  console.error("STATUS_TRANSITIONS (civic.ts) and status_transition_rules() (SQL) disagree:");
  for (const k of onlyTs) console.error(`  only in TS:  ${k}`);
  for (const k of onlySql) console.error(`  only in SQL: ${k}`);
  if (duplicates) console.error(`  ${duplicates} duplicate row(s) in SQL`);
  process.exit(1);
}
console.log(`status transitions: TS and SQL agree (${sql.size} rows)`);
