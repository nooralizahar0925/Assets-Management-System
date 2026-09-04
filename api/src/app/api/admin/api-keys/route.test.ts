import { describe, it, expect, beforeAll } from "vitest";
import { createOrg, createUserWithRole } from "@/test/org";
import { createSession } from "@/lib/auth/session";
import { mintApiKey } from "@/lib/auth/apikey";
import { GET, POST } from "./route";
import { DELETE } from "./[id]/route";

let orgId: string;
let otherOrgId: string;
let adminSession: string;
let viewerSession: string;

const req = (session: string, method = "GET", body?: unknown) =>
  new Request("http://api.test/api/admin/api-keys", {
    method,
    headers: { cookie: `ams_session=${session}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeAll(async () => {
  orgId = await createOrg("Keys Org");
  otherOrgId = await createOrg("Other Keys Org");
  adminSession = await createSession(
    (await createUserWithRole(orgId, "Administrator")).id, orgId);
  viewerSession = await createSession(
    (await createUserWithRole(orgId, "Viewer")).id, orgId);
});

describe("GET /api/admin/api-keys", () => {
  it("refuses a caller without the admin scope", async () => {
    const res = await GET(req(viewerSession));
    expect(res.status).toBe(403);
  });

  it("refuses an unauthenticated caller", async () => {
    const res = await GET(new Request("http://api.test/api/admin/api-keys"));
    expect(res.status).toBe(401);
  });

  it("never returns the key hash or the plaintext", async () => {
    await mintApiKey(orgId, "listed", ["assets:read"]);
    const res = await GET(req(adminSession));
    expect(res.status).toBe(200);

    const body = (await res.json()) as { data: Record<string, unknown>[] };
    expect(body.data.length).toBeGreaterThan(0);
    for (const row of body.data) {
      expect(row).not.toHaveProperty("key_hash");
      expect(row).not.toHaveProperty("key");
    }
  });

  it("does not list another tenant's keys", async () => {
    const mine = await mintApiKey(orgId, "mine", ["assets:read"]);
    const theirs = await mintApiKey(otherOrgId, "theirs", ["assets:read"]);

    const body = (await (await GET(req(adminSession))).json()) as {
      data: { id: string }[];
    };
    const ids = body.data.map((r) => r.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
  });
});

describe("POST /api/admin/api-keys", () => {
  it("rejects an empty name", async () => {
    const res = await POST(req(adminSession, "POST", { name: "", scopes: ["assets:read"] }));
    expect(res.status).toBe(422);
  });

  it("rejects an unknown scope", async () => {
    const res = await POST(
      req(adminSession, "POST", { name: "bad", scopes: ["assets:destroy"] }),
    );
    expect(res.status).toBe(422);
  });

  it("rejects an empty scope list", async () => {
    const res = await POST(req(adminSession, "POST", { name: "none", scopes: [] }));
    expect(res.status).toBe(422);
  });

  it("returns the plaintext exactly once, on creation", async () => {
    const res = await POST(
      req(adminSession, "POST", { name: "CI", scopes: ["assets:read"] }),
    );
    expect(res.status).toBe(201);

    const created = (await res.json()) as { id: string; key: string };
    expect(created.key).toMatch(/^ams_live_[0-9a-f]{8}\.[A-Za-z0-9_-]{32}$/);

    // It must never appear again on the listing.
    const listed = (await (await GET(req(adminSession))).json()) as {
      data: { id: string; key?: string }[];
    };
    const row = listed.data.find((r) => r.id === created.id);
    expect(row).toBeDefined();
    expect(row?.key).toBeUndefined();
  });

  it("refuses a viewer", async () => {
    const res = await POST(
      req(viewerSession, "POST", { name: "nope", scopes: ["assets:read"] }),
    );
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/admin/api-keys/[id]", () => {
  const del = (session: string, id: string) =>
    DELETE(
      new Request(`http://api.test/api/admin/api-keys/${id}`, {
        method: "DELETE",
        headers: { cookie: `ams_session=${session}` },
      }),
      { params: Promise.resolve({ id }) },
    );

  it("revokes a key", async () => {
    const key = await mintApiKey(orgId, "revoke me", ["assets:read"]);
    expect((await del(adminSession, key.id)).status).toBe(204);
  });

  it("is not repeatable — a second revoke reports not found", async () => {
    const key = await mintApiKey(orgId, "twice", ["assets:read"]);
    expect((await del(adminSession, key.id)).status).toBe(204);
    expect((await del(adminSession, key.id)).status).toBe(404);
  });

  it("cannot revoke another tenant's key", async () => {
    const theirs = await mintApiKey(otherOrgId, "not yours", ["assets:read"]);
    // Row-level security makes it invisible, so it reads as missing rather than
    // forbidden — which is the correct answer: ids are not shared across orgs.
    expect((await del(adminSession, theirs.id)).status).toBe(404);
  });

  it("refuses a viewer", async () => {
    const key = await mintApiKey(orgId, "guarded", ["assets:read"]);
    expect((await del(viewerSession, key.id)).status).toBe(403);
  });
});
