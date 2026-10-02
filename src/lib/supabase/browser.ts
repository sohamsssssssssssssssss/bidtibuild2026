import { createBrowserClient } from "@supabase/ssr";

let client: ReturnType<typeof createBrowserClient> | undefined;
let pendingSignIn: Promise<void> | undefined;

export function createSupabaseBrowserClient() {
  client ??= createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return client;
}

export function ensureCitizenSession(): Promise<void> {
  pendingSignIn ??= (async () => {
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase.auth.getUser();
    if (error && error.name !== "AuthSessionMissingError") throw error;
    if (data.user) return;
    const signIn = await supabase.auth.signInAnonymously();
    if (signIn.error) throw signIn.error;
  })().finally(() => {
    pendingSignIn = undefined;
  });
  return pendingSignIn;
}
