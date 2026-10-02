/**
 * 02 §6.8 "concurrent runs queue up instead of duplicating hotspots": starts two psql sessions at
 * once, each running
 *
 *   begin; select regenerate_city_pulse(<CITY_PULSE_CONFIG>); select pg_sleep(1); commit;
 *
 * and then asserts there is exactly ONE active set — the active hotspots share one generated_at and
 * their count equals what a single run produces — while both runs' rows were kept (total hotspot rows
 * grew by exactly two runs' worth, the earlier run's now inactive history). Without the advisory lock
 * the second run cannot see the first run's uncommitted rows, so both sets stay active and this fails
 * (when a run produces at least one hotspot, i.e. on the seeded DB).
 *
 * Usage: node scripts/db-test/check-city-pulse-concurrency.ts <database url>
 * Runs with Node's built-in type stripping (no build step). Uses psql, so no pg dependency.
 * Leaves the two runs' hotspot rows in the database (scripts/db-test/run.sh runs it after the SQL tests).
 */
import { execFileSync, spawn } from "node:child_process";
import { CITY_PULSE_CONFIG } from "../../src/config/civic.ts";

const dbUrl: string = process.argv[2] ?? "";
if (!dbUrl) {
  console.error("usage: node scripts/db-test/check-city-pulse-concurrency.ts <database url>");
  process.exit(2);
}

const PSQL_ARGS = ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-At"];
const config = `'${JSON.stringify(CITY_PULSE_CONFIG).replaceAll("'", "''")}'::jsonb`;
const SLEEP_SECONDS = 1;

function query(sql: string): string {
  return execFileSync("psql", [...PSQL_ARGS, dbUrl, "-c", sql], { encoding: "utf8" }).trim();
}

function run(label: string): Promise<void> {
  const sql =
    `begin; select jsonb_array_length(public.regenerate_city_pulse(${config}) -> 'hotspots'); ` +
    `select pg_sleep(${SLEEP_SECONDS}); commit;`;
  return new Promise((resolve, reject) => {
    const child = spawn("psql", [...PSQL_ARGS, dbUrl, "-c", sql], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`run ${label} exited ${code}: ${stderr.trim()}`)),
    );
  });
}

// What one run produces now (rolled back, so nothing changes).
const single = Number(
  query(`begin; select jsonb_array_length(public.regenerate_city_pulse(${config}) -> 'hotspots'); rollback;`),
);
const totalBefore = Number(query("select count(*) from public.hotspots"));

await Promise.all([run("A"), run("B")]);

const [active, distinctGeneratedAt, totalAfter] = query(
  "select count(*) filter (where active), count(distinct generated_at) filter (where active), count(*) " +
    "from public.hotspots",
)
  .split("|")
  .map(Number);

const failures: string[] = [];
if (active !== single) {
  failures.push(`${active} active hotspot(s) after two concurrent runs; one run produces ${single}`);
}
if (distinctGeneratedAt > 1 || (single > 0 && distinctGeneratedAt !== 1)) {
  failures.push(`active hotspots carry ${distinctGeneratedAt} distinct generated_at values; expected one set`);
}
if (totalAfter !== totalBefore + 2 * single) {
  failures.push(`hotspot rows grew by ${totalAfter - totalBefore}; expected 2 runs x ${single} (history kept)`);
}

if (failures.length) {
  console.error("regenerate_city_pulse concurrency check failed (02 §6.8):");
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(
  `city pulse concurrency: two concurrent runs left one active set of ${single} hotspot(s); ` +
    `${totalAfter - totalBefore} row(s) written (history kept)`,
);
