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
  /**
   * Whether this organisation's plan includes a feature.
   *
   * Separate from `can`: a permission is what this person may do, a feature is
   * what the organisation has bought. Somebody can hold every permission in
   * the product and still not have stock-takes.
   */
  has: (feature: string) => boolean;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [features, setFeatures] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<{
        org_id: string; user: SessionUser; features?: string[];
      }>("/api/admin/auth/me");
      setUser(me.user);
      setOrgId(me.org_id);
      // Absent while the API is a version behind during a rolling deploy. An
      // empty list would hide every optional feature; treating it as "not
      // known yet" and allowing them is the kinder failure, since the API
      // refuses anything that is genuinely not included.
      setFeatures(me.features ?? null);
    } catch (err) {
      // A 401 here is the normal signed-out state, not a failure worth surfacing.
      if (!(err instanceof ApiError) || err.status !== 401) console.error(err);
      setUser(null);
      setOrgId(null);
      setFeatures(null);
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

  const has = useCallback(
    (feature: string) =>
      // null means the API did not say - a version behind during a rolling
      // deploy. Allowing then is the kinder failure: the API still refuses
      // anything genuinely not included, so the worst case is a menu item
      // that leads to an explanation rather than a feature quietly vanishing.
      features === null || features.includes(feature),
    [features],
  );

  const value = useMemo(
    () => ({ user, orgId, loading, signIn, signOut, can, has }),
    [user, orgId, loading, signIn, signOut, can, has],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside an AuthProvider");
  return value;
}
