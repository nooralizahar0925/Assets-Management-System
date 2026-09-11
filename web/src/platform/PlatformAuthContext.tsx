import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from "react";
import type { ReactNode } from "react";
import { platformApi, type PlatformActor } from "../api/platform";
import { ApiError } from "../api/client";

/**
 * Who is operating the console.
 *
 * Deliberately not the tenant AuthContext. Two identity planes, two doors: a
 * signed-in customer administrator is an anonymous stranger here, and sharing
 * one context would make that a matter of which fields happened to be set
 * rather than which cookie the browser sent.
 */

interface PlatformAuthValue {
  operator: PlatformActor | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const PlatformAuthContext = createContext<PlatformAuthValue | null>(null);

export function PlatformAuthProvider({ children }: { children: ReactNode }) {
  const [operator, setOperator] = useState<PlatformActor | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setOperator(await platformApi.me());
    } catch (err) {
      // A 401 is the ordinary signed-out state, not a failure worth surfacing.
      if (!(err instanceof ApiError) || err.status !== 401) console.error(err);
      setOperator(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const signIn = useCallback(async (email: string, password: string) => {
    await platformApi.signIn(email, password);
    await refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await platformApi.signOut().catch(() => undefined);
    setOperator(null);
  }, []);

  const value = useMemo(
    () => ({ operator, loading, signIn, signOut }),
    [operator, loading, signIn, signOut],
  );

  return (
    <PlatformAuthContext.Provider value={value}>
      {children}
    </PlatformAuthContext.Provider>
  );
}

export function usePlatformAuth(): PlatformAuthValue {
  const value = useContext(PlatformAuthContext);
  if (!value) {
    throw new Error("usePlatformAuth must be used inside PlatformAuthProvider");
  }
  return value;
}
