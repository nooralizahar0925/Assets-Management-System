import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from "react";
import { api, ApiError } from "../api/client";

export interface SessionUser {
  id: string;
  name: string;
  /**
   * The fine-grained permissions the person's role grants. This is what the API
   * actually enforces, so it is what the UI gates on - deciding from the coarse
   * published scopes instead would offer actions the API then refuses, and hide
   * ones it would allow.
   */
  permissions: string[];
  /** null means organisation-wide; a list means only those branches. */
  location_scope: string[] | null;
  /** The published v1 scopes, kept for display. Never used for gating. */
  scopes: string[];
}

interface AuthValue {
  user: SessionUser | null;
  orgId: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<{ org_id: string; user: SessionUser }>(
        "/api/admin/auth/me",
      );
      setUser(me.user);
      setOrgId(me.org_id);
    } catch (err) {
      // A 401 here is the normal signed-out state, not a failure worth surfacing.
      if (!(err instanceof ApiError) || err.status !== 401) console.error(err);
      setUser(null);
      setOrgId(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(async (email: string, password: string) => {
    await api.post("/api/admin/auth/login", { email, password });
    await refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await api.post("/api/admin/auth/logout").catch(() => undefined);
    setUser(null);
    setOrgId(null);
  }, []);

  const can = useCallback(
    (permission: string) =>
      Boolean(user?.permissions?.includes(permission)),
    [user],
  );

  const value = useMemo(
    () => ({ user, orgId, loading, signIn, signOut, can }),
    [user, orgId, loading, signIn, signOut, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside an AuthProvider");
  return value;
}
