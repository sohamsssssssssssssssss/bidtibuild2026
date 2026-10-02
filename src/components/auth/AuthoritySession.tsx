"use client";

import { FormEvent, useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type State = "checking" | "login" | "ready";

async function isAuthority(userId: string): Promise<boolean> {
  const { data, error } = await createSupabaseBrowserClient().rpc(
    "is_authority",
    { p_user_id: userId },
  );
  if (error) throw error;
  return data === true;
}

export function AuthoritySession({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [state, setState] = useState<State>("checking");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data, error: authError } =
        await createSupabaseBrowserClient().auth.getUser();
      if (authError && authError.name !== "AuthSessionMissingError")
        throw authError;
      const allowed = data.user ? await isAuthority(data.user.id) : false;
      if (active) setState(allowed ? "ready" : "login");
    })().catch((cause: unknown) => {
      if (active) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not check authority session.",
        );
        setState("login");
      }
    });
    return () => {
      active = false;
    };
  }, []);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const { data, error: authError } =
      await createSupabaseBrowserClient().auth.signInWithPassword({
        email: String(form.get("email")),
        password: String(form.get("password")),
      });
    if (authError) setError(authError.message);
    else if (!data.user || !(await isAuthority(data.user.id))) {
      await createSupabaseBrowserClient().auth.signOut();
      setError("This account does not have authority access.");
    } else setState("ready");
    setBusy(false);
  }

  if (state === "checking")
    return (
      <section className="state-panel" role="status">
        Checking authority session…
      </section>
    );
  if (state === "ready")
    return (
      <>
        {children}
        <button
          className="text-button"
          onClick={() => {
            void createSupabaseBrowserClient()
              .auth.signOut()
              .then(() => setState("login"));
          }}
        >
          Sign out of authority
        </button>
      </>
    );
  return (
    <section className="login-card">
      <p className="eyebrow">Restricted access</p>
      <h2>Authority sign in</h2>
      <p>
        Use the configured authority account to open the read-only workspace.
      </p>
      <form onSubmit={login}>
        <label>
          Email
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
