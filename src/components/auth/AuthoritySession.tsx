"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/browser";

export function AuthoritySession({ children }: { children: ReactNode }) {
  const [client] = useState(createClient);
  const [state, setState] = useState<
    "checking" | "signed-out" | "signed-in" | "unavailable"
  >("checking");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!client) return;
    let active = true;
    client.auth
      .getUser()
      .then(async ({ data, error: sessionError }) => {
        if (sessionError && !isAuthSessionMissingError(sessionError))
          throw sessionError;
        if (!data.user) return false;
        const result = await client.rpc("is_authority", {
          p_user_id: data.user.id,
        });
        if (result.error) throw result.error;
        return result.data === true;
      })
      .then((authority) => {
        if (active) setState(authority ? "signed-in" : "signed-out");
      })
      .catch(() => {
        if (active) setState("unavailable");
      });
    return () => {
      active = false;
    };
  }, [client]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client) return;
    setSubmitting(true);
    setError("");
    try {
      const result = await client.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (result.error || !result.data.user) {
        setError("Sign-in failed. Check the authority email and password.");
        return;
      }
      const check = await client.rpc("is_authority", {
        p_user_id: result.data.user.id,
      });
      if (check.error)
        setError("Could not verify authority access. Try again.");
      else if (check.data !== true) {
        await client.auth.signOut();
        setError("This account does not have authority access.");
      } else setState("signed-in");
    } catch {
      setError("Authority sign-in is unavailable. Try again.");
    } finally {
      setPassword("");
      setSubmitting(false);
    }
  }

  if (!client)
    return (
      <p className="read-state">
        Authority sign-in is unavailable until Supabase is configured.
      </p>
    );
  if (state === "checking")
    return (
      <p className="read-state" role="status">
        Checking authority session…
      </p>
    );
  if (state === "unavailable")
    return (
      <p className="read-state" role="alert">
        Could not check authority access. Reload to retry.
      </p>
    );
  if (state === "signed-out")
    return (
      <form className="authority-login" onSubmit={signIn}>
        <h2>Authority sign-in</h2>
        <p>Use the authority account configured for this demo.</p>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <button type="submit" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    );

  return (
    <div className="authority-content">
      <div className="authority-session">
        <span>Authority session · Read-only Phase 0 workspace</span>
        <button
          type="button"
          onClick={async () => {
            await client.auth.signOut();
            setState("signed-out");
          }}
        >
          Sign out
        </button>
      </div>
      {children}
    </div>
  );
}
