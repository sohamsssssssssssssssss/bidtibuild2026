"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

let sessionStart: Promise<void> | undefined;

export function CitizenSession() {
  const [supabase] = useState(createClient);
  const [message, setMessage] = useState(
    supabase ? "" : "Citizen session unavailable until Supabase is configured.",
  );
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    sessionStart ??= supabase.auth.getUser().then(async ({ data, error }) => {
      if (error && error.code !== "session_not_found") throw error;
      if (data.user) return;
      const result = await supabase.auth.signInAnonymously();
      if (result.error) throw result.error;
    });
    sessionStart.catch(() => {
      if (active)
        setMessage("Could not start your citizen session. Reload to retry.");
    });
    return () => {
      active = false;
    };
  }, [supabase]);
  return message ? (
    <p className="session-error" role="status">
      {message}
    </p>
  ) : null;
}
