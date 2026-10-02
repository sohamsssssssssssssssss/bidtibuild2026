"use client";

import { useEffect, useState } from "react";
import { ensureCitizenSession } from "@/lib/supabase/browser";

export function CitizenSession() {
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    ensureCitizenSession()
      .then((user) => {
        if (active && !user)
          setMessage(
            "Citizen session unavailable until Supabase is configured.",
          );
      })
      .catch(() => {
        if (active)
          setMessage("Could not start your citizen session. Reload to retry.");
      });
    return () => {
      active = false;
    };
  }, []);
  return message ? (
    <p className="session-error" role="status">
      {message}
    </p>
  ) : null;
}
