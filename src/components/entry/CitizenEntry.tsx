"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ensureCitizenSession } from "@/lib/supabase/browser";

/**
 * Citizens are Supabase anonymous users (02 §7.1): "signing in" creates or
 * reuses this device's anonymous session, then opens the citizen app.
 */
export function CitizenEntry() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function enter(target: string) {
    setBusy(true);
    setError("");
    try {
      await ensureCitizenSession();
      router.push(target);
    } catch (cause) {
      setError(
        cause instanceof TypeError
          ? "Network error. Check your connection and retry."
          : cause instanceof Error
            ? cause.message
            : "Could not start a citizen session. Please retry.",
      );
      setBusy(false);
    }
  }

  return (
    <section className="login-card">
      <p className="eyebrow">Citizen access</p>
      <h2>Continue as citizen</h2>
      <p>Your reports stay linked to this device. Nothing else is needed.</p>
      <div className="entry-actions">
        <button type="button" disabled={busy} onClick={() => void enter("/")}>
          {busy ? "Starting…" : "Continue to issue map"}
        </button>
        <button
          type="button"
          className="entry-secondary"
          disabled={busy}
          onClick={() => void enter("/report")}
        >
          Report an issue now
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
