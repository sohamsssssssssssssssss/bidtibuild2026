/**
 * Per-IP rate limit (02 §9): RATE_LIMIT_CONFIG.max_reports_per_ip_hash reports per hashed client
 * IP per rolling window, across users.
 *
 * OPT-IN (RUN_IP_LIMIT_TEST=1): it creates max_reports_per_ip_hash (100) reports from
 * ceil(100 / max_reports_per_user) + 1 anonymous citizens. It sends a fresh fake x-forwarded-for
 * (the route hashes the first entry, phase-1 contract), so it only exhausts that fake IP's budget
 * and can run alongside the other tests — but the anonymous sign-ins still count against local
 * Auth's 100/hour per real IP (supabase/config.toml), and the rows stay until `demo:reset`.
 * Behind Vercel the platform sets x-forwarded-for, so clients cannot pick their IP there.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { RATE_LIMIT_CONFIG } from "../../src/config/civic.ts";
import {
  countReportsBy,
  createReport,
  expectError,
  newCitizen,
  postReport,
  randomFakeIp,
  RATE_LIMITED_MESSAGE,
  testOptions,
  type Citizen,
} from "./helpers.ts";

const OPT_IN =
  process.env.RUN_IP_LIMIT_TEST === "1"
    ? false
    : `opt-in: set RUN_IP_LIMIT_TEST=1 (creates ${RATE_LIMIT_CONFIG.max_reports_per_ip_hash} reports and ~${
        Math.ceil(RATE_LIMIT_CONFIG.max_reports_per_ip_hash / RATE_LIMIT_CONFIG.max_reports_per_user) + 1
      } anonymous users)`;

test(
  `per-IP rate limit: report ${RATE_LIMIT_CONFIG.max_reports_per_ip_hash + 1} from one IP → 429 RATE_LIMITED`,
  testOptions({ skip: OPT_IN, timeout: 600_000 }),
  async () => {
    const ip = randomFakeIp();
    const perUser = RATE_LIMIT_CONFIG.max_reports_per_user;
    let made = 0;
    while (made < RATE_LIMIT_CONFIG.max_reports_per_ip_hash) {
      const citizen = await newCitizen();
      const n = Math.min(perUser, RATE_LIMIT_CONFIG.max_reports_per_ip_hash - made);
      for (let i = 0; i < n; i++) await createReport(citizen, { ip });
      made += n;
    }

    // A citizen well under their own limit is refused because the IP is used up.
    const fresh: Citizen = await newCitizen();
    const { res } = await postReport(fresh, { ip });
    assert.equal(expectError(res, 429, "RATE_LIMITED"), RATE_LIMITED_MESSAGE);
    assert.equal(await countReportsBy(fresh.userId), 0);

    // The same citizen from another IP is fine: the limit is per IP, not global.
    await createReport(fresh, { ip: randomFakeIp() });
  },
);
