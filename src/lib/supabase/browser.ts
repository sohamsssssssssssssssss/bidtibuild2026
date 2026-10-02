"use client";

import { createBrowserClient } from "@supabase/ssr";
import { isAuthSessionMissingError, type User } from "@supabase/supabase-js";

let anonymousStart: Promise<User> | undefined;

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createBrowserClient(url, key);
}

export async function ensureCitizenSession(): Promise<User | null> {
  const client = createClient();
  if (!client) return null;
  const { data, error } = await client.auth.getUser();
  if (error && !isAuthSessionMissingError(error)) throw error;
  if (data.user) return data.user;
  anonymousStart ??= client.auth
    .signInAnonymously()
    .then(({ data: signed, error: signError }) => {
      if (signError) throw signError;
      if (!signed.user) throw new Error("Anonymous sign-in returned no user");
      return signed.user;
    })
    .finally(() => {
      anonymousStart = undefined;
    });
  return await anonymousStart;
}
