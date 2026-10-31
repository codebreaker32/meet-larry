"use client";

import * as React from "react";
import { syncAccount } from "@/lib/account/sync-client";
import { AUTH_CHANGED_EVENT, authFetch, maybeSignedIn, signOutHere, watchAuth } from "@/lib/firebase/client";
import type { Account } from "@/lib/types/account";
import { saveAgeBucket } from "@/lib/age";

// Who is signed in on this device, and their account. Mounted once in the root layout.
// A visitor who never signed in costs nothing: the Firebase SDK is not loaded for them.

export type AuthStatus =
  /** Still finding out (only while this device may be signed in). */
  | "loading"
  | "signed-out"
  /** Phone verified, but sign-up isn't finished (or was turned away by the 18+ check). */
  | "needs-signup"
  | "signed-in";

export interface AuthState {
  status: AuthStatus;
  account: Account | null;
  /** Reloads the account (after sign-up or a settings change). */
  refresh(): Promise<void>;
  /** Puts a fresh account in place without a round trip (the PATCH answer). */
  setAccount(a: Account): void;
  signOut(): Promise<void>;
}

const AuthContext = React.createContext<AuthState | null>(null);

const SIGNED_OUT: AuthState = {
  status: "signed-out",
  account: null,
  refresh: async () => {},
  setAccount: () => {},
  signOut: async () => {},
};

/** The account state. Outside the provider (tests, isolated renders) it reads as signed out. */
export function useAuth(): AuthState {
  return React.useContext(AuthContext) ?? SIGNED_OUT;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<AuthStatus>("loading");
  const [account, setAccountState] = React.useState<Account | null>(null);
  const [epoch, setEpoch] = React.useState(0);
  const uidRef = React.useRef<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await authFetch("/api/account", { cache: "no-store" });
      if (res.ok) {
        const acct = (await res.json()) as Account;
        setAccountState(acct);
        // The account's date of birth decides the range, so the device and the 18+ account agree.
        if (acct.ageBucket) saveAgeBucket(acct.ageBucket);
        setStatus("signed-in");
        // Once a day at most, never from a check-in tap (D11).
        void syncAccount(authFetch);
      } else if (res.status === 404) {
        setAccountState(null);
        setStatus("needs-signup");
      } else if (res.status === 401) {
        setAccountState(null);
        setStatus("signed-out");
      }
    } catch {
      // Offline: keep whatever we had; the next visit tries again.
    }
  }, []);

  // Re-subscribe after this tab signs in or out (the SDK may only now be needed).
  React.useEffect(() => {
    const bump = () => setEpoch((e) => e + 1);
    window.addEventListener(AUTH_CHANGED_EVENT, bump);
    return () => window.removeEventListener(AUTH_CHANGED_EVENT, bump);
  }, []);

  React.useEffect(() => {
    const stop = watchAuth(
      (user) => {
        if (!user) {
          uidRef.current = null;
          setAccountState(null);
          setStatus("signed-out");
          return;
        }
        // Token refreshes call this again with the same uid; only a new uid reloads.
        if (uidRef.current === user.uid) return;
        uidRef.current = user.uid;
        void load();
      },
      epoch > 0 || maybeSignedIn(),
    );
    return stop;
  }, [epoch, load]);

  const value = React.useMemo<AuthState>(
    () => ({
      status,
      account,
      refresh: load,
      setAccount: (a) => {
        setAccountState(a);
        setStatus("signed-in");
      },
      signOut: async () => {
        await signOutHere();
        uidRef.current = null;
        setAccountState(null);
        setStatus("signed-out");
      },
    }),
    [status, account, load],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
