/**
 * npm run demo:reset — rebuilds the demo from scratch (docs/02_TECHNICAL_SPEC.md §14).
 *
 *   1. `supabase db reset --linked` (or `--local` when run with `--local`): migrations + seed.sql
 *   2. Creates the authority account through the Auth admin API (AUTHORITY_EMAIL / AUTHORITY_PASSWORD)
 *      and its `public.users` row (02 §7.2)
 *   3. Calls `regenerate_city_pulse(p_config)` (02 §6.8)
 *
 * Run with Node >= 22.18 (native type stripping): `node scripts/demo-reset.ts [--local]`.
 * Erasable TypeScript only (no enums, namespaces or parameter properties).
 *
 * Env (loaded from .env.local / .env if present): NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, AUTHORITY_EMAIL, AUTHORITY_PASSWORD. The password is never logged.
 */
import { spawn } from "node:child_process";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { CITY_PULSE_CONFIG } from "../src/config/civic.ts";

const AUTHORITY_NAME = "Demo Authority";

function fail(message: string): never {
  console.error(`\n✖ demo:reset failed: ${message}`);
  process.exit(1);
}

function loadEnv(): void {
  // Earlier files win: process.loadEnvFile never overrides a variable that is already set.
  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(file);
    } catch {
      // missing file: fine
    }
  }
}

type Env = { url: string; serviceRoleKey: string; authorityEmail: string; authorityPassword: string };

function readEnv(): Env {
  const names = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "AUTHORITY_EMAIL", "AUTHORITY_PASSWORD"] as const;
  const missing = names.filter((n) => !process.env[n]?.trim());
  if (missing.length > 0) {
    fail(
      `missing environment variable(s): ${missing.join(", ")}.\n` +
        "  Set them in .env.local (see .env.example). Nothing was reset.",
    );
  }
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(),
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(),
    authorityEmail: process.env.AUTHORITY_EMAIL!.trim().toLowerCase(),
    authorityPassword: process.env.AUTHORITY_PASSWORD!,
  };
}

/** Step 1: rebuild the database from migrations + seed.sql, streaming the CLI's output. */
function resetDatabase(target: "--linked" | "--local"): Promise<void> {
  const args = ["supabase", "db", "reset", target, "--yes"];
  console.log(`\n▶ 1/3 npx ${args.join(" ")}`);
  return new Promise((resolve, reject) => {
    const child = spawn("npx", args, { stdio: "inherit", shell: process.platform === "win32" });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`supabase db reset exited with ${signal ?? `code ${code}`}`));
    });
  });
}

async function findUserByEmail(admin: SupabaseClient, email: string): Promise<User | undefined> {
  const perPage = 1000;
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const found = data.users.find((u) => u.email?.toLowerCase() === email);
    if (found) return found;
    if (data.users.length < perPage) return undefined;
  }
}

/** Step 2: the authority auth user (email + password) and its `users` row. */
async function ensureAuthority(admin: SupabaseClient, env: Env): Promise<{ id: string; created: boolean }> {
  console.log(`\n▶ 2/3 authority account ${env.authorityEmail}`);
  let id: string;
  let created: boolean;

  const { data, error } = await admin.auth.admin.createUser({
    email: env.authorityEmail,
    password: env.authorityPassword,
    email_confirm: true,
    user_metadata: { name: AUTHORITY_NAME },
  });
  if (!error) {
    id = data.user.id;
    created = true;
  } else if (error.code === "email_exists" || error.code === "user_already_exists" || /already (been )?registered|already exists/i.test(error.message)) {
    // The auth schema survived the reset: reuse the user and make sure the env password works.
    const existing = await findUserByEmail(admin, env.authorityEmail);
    if (!existing) throw new Error(`createUser says ${env.authorityEmail} exists, but listUsers cannot find it`);
    const { error: updateError } = await admin.auth.admin.updateUserById(existing.id, {
      password: env.authorityPassword,
      email_confirm: true,
    });
    if (updateError) throw new Error(`updating the existing authority user failed: ${updateError.message}`);
    id = existing.id;
    created = false;
  } else {
    throw new Error(`createUser failed: ${error.message}`);
  }

  // Authority = a users row with role AUTHORITY (02 §7.2). service_role bypasses RLS.
  const { error: upsertError } = await admin
    .from("users")
    .upsert({ id, name: AUTHORITY_NAME, email: env.authorityEmail, role: "AUTHORITY" }, { onConflict: "id" });
  if (upsertError) throw new Error(`inserting public.users row failed: ${upsertError.message}`);

  console.log(`  ${created ? "created" : "already existed (password reset to AUTHORITY_PASSWORD)"}: ${id}`);
  return { id, created };
}

type PulseOutcome = { status: "ran"; result: unknown } | { status: "skipped" };

/** Step 3: City Pulse (02 §6.8). Missing function (PGRST202) = not built yet (Phase 5). */
async function regenerateCityPulse(admin: SupabaseClient): Promise<PulseOutcome> {
  console.log("\n▶ 3/3 regenerate_city_pulse");
  const { data, error } = await admin.rpc("regenerate_city_pulse", { p_config: CITY_PULSE_CONFIG });
  if (error) {
    if (error.code === "PGRST202") {
      console.log("  skipped: regenerate_city_pulse not implemented yet (Phase 5)");
      return { status: "skipped" };
    }
    throw new Error(`regenerate_city_pulse failed: ${error.code ?? ""} ${error.message}`.trim());
  }
  console.log(`  done: ${JSON.stringify(data)?.slice(0, 500) ?? "null"}`);
  return { status: "ran", result: data };
}

async function main(): Promise<void> {
  loadEnv();
  const target = process.argv.slice(2).includes("--local") ? "--local" : "--linked";
  const env = readEnv(); // fail fast, before anything is wiped

  await resetDatabase(target);

  const admin = createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const authority = await ensureAuthority(admin, env);
  const pulse = await regenerateCityPulse(admin);

  const { count: issueCount, error: countError } = await admin
    .from("issues")
    .select("id", { count: "exact", head: true });
  const { count: hotspotCount } = await admin
    .from("hotspots")
    .select("id", { count: "exact", head: true })
    .eq("active", true);

  console.log("\n✔ demo:reset complete");
  console.log(`  database:     reset (${target}) from migrations + supabase/seed.sql`);
  console.log(`  seed issues:  ${countError ? `unknown (${countError.message})` : issueCount}`);
  console.log(`  authority:    ${env.authorityEmail} (${authority.created ? "created" : "existing"}, id ${authority.id})`);
  console.log(
    `  City Pulse:   ${pulse.status === "skipped" ? "skipped (Phase 5)" : `regenerated, ${hotspotCount ?? "?"} active hotspot(s)`}`,
  );
}

main().catch((err: unknown) => fail(err instanceof Error ? err.message : String(err)));
