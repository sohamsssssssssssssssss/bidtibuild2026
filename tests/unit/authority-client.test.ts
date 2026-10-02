/**
 * Authority browser client (src/lib/authority/api.ts): writes resolve only
 * with a contract-valid server result, every failure surfaces the server's
 * message, and the browser code never touches server-only secrets.
 */
import { strict as assert } from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { AuthorityApiError, authorityApi, queueUrl } from "../../src/lib/authority/api";
import { ageLabel, slaState } from "../../src/lib/authority/format";

const ISSUE = "11111111-1111-4111-8111-111111111111";
const DEPT = "5eedde00-0000-4000-8000-000000000001";
const NOW = "2026-10-02T10:00:00.000+00:00";

const realFetch = globalThis.fetch;
let calls: { url: string; init?: RequestInit }[] = [];

function mockFetch(status: number, body: unknown) {
  calls = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("authority client", () => {
  it("builds queue URLs from the canonical query (repeated keys, unassigned)", () => {
    assert.equal(queueUrl(), "/api/authority/queue");
    assert.equal(
      queueUrl({ status: ["REPORTED", "ASSIGNED"], category: ["POTHOLE"], department_id: "unassigned" }),
      "/api/authority/queue?status=REPORTED&status=ASSIGNED&category=POTHOLE&department_id=unassigned",
    );
  });

  it("sends the assign body and returns the server result", async () => {
    const result = {
      issue_id: ISSUE,
      status: "ASSIGNED",
      updated_at: NOW,
      event_type: "ASSIGNED",
      department: { id: DEPT, name: "Roads" },
      assigned_at: NOW,
      sla_due_at: NOW,
    };
    mockFetch(200, { data: result, error: null });
    assert.deepEqual(await authorityApi.assign(ISSUE, DEPT), result);
    const [call] = calls;
    assert.ok(call);
    assert.equal(call.url, `/api/issues/${ISSUE}/assign`);
    assert.equal(call.init?.method, "POST");
    assert.deepEqual(JSON.parse(String(call.init?.body)), { department_id: DEPT });
  });

  it("rejects with the server's code and message on an error envelope", async () => {
    mockFetch(409, {
      data: null,
      error: { code: "INVALID_TRANSITION", message: "That status change isn't allowed from the issue's current status." },
    });
    await assert.rejects(authorityApi.transition(ISSUE, "IN_PROGRESS"), (err: unknown) => {
      assert.ok(err instanceof AuthorityApiError);
      assert.equal(err.code, "INVALID_TRANSITION");
      assert.equal(err.status, 409);
      assert.match(err.message, /isn't allowed/);
      return true;
    });
  });

  it("never treats a 200 with an off-contract body as success", async () => {
    mockFetch(200, { data: { ok: true }, error: null });
    await assert.rejects(authorityApi.setPriority(ISSUE, { final_priority: "HIGH" }), (err: unknown) => {
      assert.ok(err instanceof AuthorityApiError);
      assert.equal(err.code, "BAD_RESPONSE");
      return true;
    });
  });

  it("maps a network failure to a retryable error", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await assert.rejects(authorityApi.departments(), (err: unknown) => {
      assert.ok(err instanceof AuthorityApiError);
      assert.equal(err.code, "NETWORK");
      return true;
    });
  });
});

describe("authority display helpers", () => {
  const now = Date.parse("2026-10-02T10:00:00Z");
  it("labels ages", () => {
    assert.equal(ageLabel("2026-10-02T09:58:00Z", now), "2m");
    assert.equal(ageLabel("2026-10-02T07:00:00Z", now), "3h");
    assert.equal(ageLabel("2026-09-29T10:00:00Z", now), "3d");
  });
  it("labels SLA due and overdue", () => {
    assert.equal(slaState(null, now), null);
    assert.deepEqual(slaState("2026-10-02T15:00:00Z", now), { label: "SLA due in 5h", overdue: false });
    assert.deepEqual(slaState("2026-10-01T10:00:00Z", now), { label: "SLA overdue 1d", overdue: true });
  });
});

describe("authority browser code", () => {
  const roots = ["src/app/authority", "src/components/authority", "src/components/auth", "src/lib/authority"];
  const files = roots.flatMap(function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
  });
  it("never refers to server-only secrets or the admin client", () => {
    assert.ok(files.length > 0);
    for (const file of files) {
      assert.doesNotMatch(
        readFileSync(file, "utf8"),
        /SUPABASE_SERVICE_ROLE_KEY|service_role|IP_HASH_SALT|supabase\/admin|getAdminClient/,
        file,
      );
    }
  });
});
