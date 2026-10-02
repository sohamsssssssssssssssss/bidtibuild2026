"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function AuthorityNavigation() {
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const login = pathname === "/authority/login";

  async function signOut() {
    setBusy(true);
    setError("");
    try {
      const { error: authError } =
        await createSupabaseBrowserClient().auth.signOut();
      if (authError) throw authError;
      router.replace("/authority/login");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Sign out failed. Retry.",
      );
      setBusy(false);
    }
  }

  return (
    <nav aria-label="Authority navigation">
      {!login && <Link href="/authority">Triage queue</Link>}
      {!login && <Link href="/authority/city-pulse">City Pulse</Link>}
      <Link href="/">Citizen map</Link>
      {!login && (
        <button type="button" onClick={() => void signOut()} disabled={busy}>
          {busy ? "Signing out…" : "Sign out"}
        </button>
      )}
      {error && <span role="alert">{error}</span>}
    </nav>
  );
}
