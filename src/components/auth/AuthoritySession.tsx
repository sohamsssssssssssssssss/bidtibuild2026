"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useSyncExternalStore,
  FormEvent,
  useContext,
  useEffect,
  useState,
} from "react";
import { TESTIDS } from "@/config/testids";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

/**
 * Authority identity comes from a `users` row checked with `is_authority`
 * (02 §7.2), never from merely being signed in. The session is the Supabase
 * cookie session, which the API routes verify server-side; no privileged key
 * is ever used in the browser.
 */
async function isAuthority(userId: string): Promise<boolean> {
  const { data, error } = await createSupabaseBrowserClient().rpc(
    "is_authority",
    { p_user_id: userId },
  );
  if (error) throw error;
  return data === true;
}

type Check =
  | { state: "checking" }
  | { state: "signed-out"; error?: string }
  | { state: "ready"; userId: string; email: string };

async function checkSession(): Promise<Check> {
  const { data, error } = await createSupabaseBrowserClient().auth.getUser();
  if (error && error.name !== "AuthSessionMissingError") throw error;
  if (!data.user || data.user.is_anonymous) return { state: "signed-out" };
  if (!(await isAuthority(data.user.id))) return { state: "signed-out" };
  return { state: "ready", userId: data.user.id, email: data.user.email ?? "" };
}

export interface AuthorityUser {
  userId: string;
  email: string;
  signOut: () => Promise<void>;
}

const AuthorityContext = createContext<AuthorityUser | null>(null);

export function useAuthorityUser(): AuthorityUser {
  const user = useContext(AuthorityContext);
  if (!user)
    throw new Error("useAuthorityUser must be used inside <AuthorityGate>");
  return user;
}

/** Renders children only for a verified authority; otherwise sends the browser to the login page. */
export function AuthorityGate({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const router = useRouter();
  const [check, setCheck] = useState<Check>({ state: "checking" });

  useEffect(() => {
    let active = true;
    checkSession()
      .then((result) => {
        if (!active) return;
        setCheck(result);
        if (result.state === "signed-out") router.replace("/authority/login");
      })
      .catch((cause: unknown) => {
        if (active)
          setCheck({
            state: "signed-out",
            error:
              cause instanceof Error
                ? cause.message
                : "Could not check the authority session.",
          });
      });
    return () => {
      active = false;
    };
  }, [router]);

  if (check.state === "ready") {
    const value: AuthorityUser = {
      userId: check.userId,
      email: check.email,
      signOut: async () => {
        await createSupabaseBrowserClient().auth.signOut();
        router.replace("/authority/login");
      },
    };
    return (
      <AuthorityContext.Provider value={value}>
        {children}
      </AuthorityContext.Provider>
    );
  }
  if (check.state === "signed-out" && check.error)
    return (
      <section className="state-panel" role="alert">
        {check.error}{" "}
        <button
          className="text-button"
          onClick={() => window.location.reload()}
        >
          Retry
        </button>
      </section>
    );
  return (
    <section className="state-panel" role="status">
      Checking authority session…
    </section>
  );
}

const noopSubscribe = () => () => {};

export function AuthorityLoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Until this client code has hydrated, Sign in stays disabled so the browser
  // can never fall back to a native form submission.
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

  useEffect(() => {
    let active = true;
    checkSession()
      .then((result) => {
        if (active && result.state === "ready") router.replace("/authority");
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [router]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const supabase = createSupabaseBrowserClient();
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword(
        {
          email: email.trim(),
          password,
        },
      );
      if (authError) {
        setError(
          authError.status === 400 || /invalid/i.test(authError.message)
            ? "Incorrect email or password."
            : authError.message,
        );
      } else if (!data.user || !(await isAuthority(data.user.id))) {
        await supabase.auth.signOut();
        setError("This account does not have authority access.");
      } else {
        router.replace("/authority");
        return;
      }
    } catch (cause) {
      setError(
        cause instanceof TypeError
          ? "Network error. Check your connection and retry."
          : cause instanceof Error
            ? cause.message
            : "Sign in failed. Please retry.",
      );
    }
    setBusy(false);
  }

  return (
    <section className="login-card">
      <p className="eyebrow">Restricted access</p>
      <h2>Authority Sign In</h2>
      <p>
        For authorized municipal staff. Citizen sessions cannot open the
        authority workspace.
      </p>
      {/* POST + unnamed inputs: even without JavaScript, credentials can never land in the URL. */}
      <form method="post" onSubmit={(event) => void login(event)}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
            required
            data-testid={TESTIDS.authorityEmail}
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
            data-testid={TESTIDS.authorityPassword}
          />
        </label>
        <button
          type="submit"
          disabled={busy || !hydrated}
          data-testid={TESTIDS.authorityLogin}
        >
          {!hydrated ? "Loading…" : busy ? "Signing in…" : "Sign in"}
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
