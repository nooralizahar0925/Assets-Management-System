import { randomBytes } from "node:crypto";
import { query, withTenant } from "../db";
import type { Ctx } from "../http/handler";

const COOKIE = "ams_session";
const TTL_DAYS = 7;

export async function createSession(userId: string, orgId: string): Promise<string> {
  const id = randomBytes(32).toString("base64url");
  // The org is already known here - login resolved it - so this write goes
  // through the tenant guard like any other.
  await withTenant(orgId, (c) =>
    c.query(
      `INSERT INTO sessions (id, org_id, user_id, expires_at)
       VALUES ($1, $2, $3, now() + ($4 || ' days')::interval)`,
      [id, orgId, userId, String(TTL_DAYS)],
    ),
  );
  return id;
}

export function sessionCookie(id: string): string {
  const maxAge = TTL_DAYS * 86_400;
  const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
  return `${COOKIE}=${id}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${maxAge}`;
}

export const clearSessionCookie = () =>
  `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

interface SessionRow {
  org_id: string;
  user_id: string;
  name: string;
  role: "admin" | "manager" | "technician" | "viewer";
}

/** A dashboard user's effective scopes derive from their role. */
function scopesForRole(role: SessionRow["role"]): string[] {
  switch (role) {
    case "viewer":
      return ["assets:read", "reports:read"];
    case "admin":
      return ["assets:read", "assets:write", "reports:read", "admin"];
    default:
      return ["assets:read", "assets:write", "reports:read"];
  }
}

export async function readSession(req: Request): Promise<Ctx | null> {
  const id = readCookie(req, COOKIE);
  if (!id) return null;
  // Pre-tenant lookup - see migration 006.
  const rows = await query<SessionRow>("SELECT * FROM auth_lookup_session($1)", [id]);
  const row = rows[0];
  if (!row) return null;
  return {
    orgId: row.org_id,
    actor: {
      type: "user",
      id: row.user_id,
      label: row.name,
      scopes: scopesForRole(row.role),
    },
  };
}

export async function destroySession(req: Request): Promise<void> {
  const id = readCookie(req, COOKIE);
  if (!id) return;
  // Resolve the session's tenant first so the delete can run under the guard.
  const rows = await query<SessionRow>("SELECT * FROM auth_lookup_session($1)", [id]);
  const row = rows[0];
  if (!row) return;
  await withTenant(row.org_id, (c) =>
    c.query("DELETE FROM sessions WHERE id = $1", [id]),
  );
}
