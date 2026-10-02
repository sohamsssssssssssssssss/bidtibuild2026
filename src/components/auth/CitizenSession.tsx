"use client";

import { useEffect, useState } from "react";
import { ensureCitizenSession } from "@/lib/supabase/browser";

export function CitizenSession() {
  const [error, setError] = useState("");
  useEffect(() => {
    void ensureCitizenSession().catch((cause: unknown) =>
      setError(
        cause instanceof Error ? cause.message : "Anonymous sign-in failed.",
      ),
    );
  }, []);
  return error ? (
    <div className="auth-alert" role="alert">
      Citizen session unavailable: {error}
    </div>
  ) : null;
}
