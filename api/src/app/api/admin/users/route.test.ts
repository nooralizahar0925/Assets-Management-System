import { describe, it, expect, beforeAll } from "vitest";
import { createOrg, createUserWithRole } from "@/test/org";
import { createSession } from "@/lib/auth/session";
import { GET } from "./route";
import { GET as PICKER } from "../../v1/users/route";

let orgId: string;
let adminSession: string;
let viewerSession: string;
let adminEmail: string;

const req = (session: string, path = "http://api.test/api/admin/users") =>
  new Request(path, { headers: { cookie: `ams_session=${session}` } });

interface Member {
  id: string; name: string; email: string;
  role_id: string | null; role_name: string | null;
  location_ids: string[]; assigned_count: number;
}

beforeAll(async () => {
  orgId = await createOrg("Member Listing Org");
  const admin = await createUserWithRole(orgId, "Administrator");
  adminEmail = admin.email;
  adminSession = await createSession(admin.id, orgId);
  viewerSession = await createSession(
    (await createUserWithRole(orgId, "Viewer")).id, orgId,
  );
});

describe("GET /api/admin/users", () => {
  it("refuses a caller without users:read", async () => {
    expect((await GET(req(viewerSession))).status).toBe(403);
  });

  it("refuses an unauthenticated caller", async () => {
    expect((await GET(new Request("http://api.test/api/admin/users"))).status).toBe(401);
  });

  it("lists members with the email and role name the People page shows", async () => {
    const body = (await (await GET(req(adminSession))).json()) as { data: Member[] };
    const admin = body.data.find((m) => m.email === adminEmail)!;

    expect(admin).toBeDefined();
    expect(admin.role_name).toBe("Administrator");
    expect(admin.role_id).toEqual(expect.any(String));
    // No rows in user_location_scopes means organisation-wide.
    expect(admin.location_ids).toEqual([]);
  });

  it("keeps email and role out of the assignment picker", async () => {
    // /api/v1/users is guarded by assets:read so a technician can choose who to
    // issue an asset to. It must not become a staff directory as a side effect.
    const body = (await (await PICKER(
      req(adminSession, "http://api.test/api/v1/users"),
    )).json()) as { data: Record<string, unknown>[] };

    expect(body.data.length).toBeGreaterThan(0);
    for (const user of body.data) {
      expect(user).not.toHaveProperty("email");
      expect(user).not.toHaveProperty("role_name");
    }
  });
});
