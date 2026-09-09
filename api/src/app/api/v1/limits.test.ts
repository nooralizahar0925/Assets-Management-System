import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { withPlatform } from "@/lib/platform/db";
import { withTenant } from "@/lib/db";
import { createOrg, createUserWithRole } from "@/test/org";
import { createSession } from "@/lib/auth/session";
import { PERMISSIONS, type PermissionKey } from "@/lib/auth/permissions";
import type { Ctx } from "@/lib/http/handler";
import { createAsset } from "@/lib/domain/assets";
import { forgetEntitlements } from "@/lib/entitlements";
import { POST as CREATE_ASSET, GET as LIST_ASSETS } from "./assets/route";
import { POST as IMPORT } from "./imports/route";

/**
 * Limits, through the real routes.
 *
 * The unit tests prove assertWithinLimit computes the right answer. These
 * prove the handlers actually ask it - which is the half that has been wrong
 * before in this project, repeatedly.
 */

let orgId: string;
let ctx: Ctx;
let session: string;

beforeAll(async () => {
  orgId = await createOrg("Limits Routes Org");
  const admin = await createUserWithRole(orgId, "Administrator");
  session = await createSession(admin.id, orgId);
  ctx = {
    orgId,
    actor: {
      type: "user", id: admin.id, label: "Admin", scopes: ["admin"],
      permissions: PERMISSIONS.map((p) => p.key) as PermissionKey[],
      locationScope: null,
    },
  };
});

const setLimits = async (limits: Record<string, number>) => {
  await withPlatform((c) =>
    c.query("UPDATE organizations SET limit_overrides = $2::jsonb WHERE id = $1",
      [orgId, JSON.stringify(limits)]),
  );
  forgetEntitlements(orgId);
};

const request = (method: string, body?: unknown) =>
  new Request("http://api.test/api/v1/assets", {
    method,
    headers: { cookie: `ams_session=${session}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const CSV = "Asset Name\nImported One\nImported Two\nImported Three\n";

const upload = (dryRun: boolean) => {
  const form = new FormData();
  form.set("file", new File([CSV], "bulk.csv", { type: "text/csv" }));
  form.set("mapping", JSON.stringify({ "Asset Name": "name" }));
  form.set("dry_run", String(dryRun));
  return new Request("http://api.test/api/v1/imports", {
    method: "POST",
    headers: { cookie: `ams_session=${session}` },
    body: form,
  });
};

beforeEach(async () => {
  await withTenant(orgId, (c) => c.query("DELETE FROM assets"));
  await setLimits({});
});

describe("creating an asset against a limit", () => {
  it("is allowed while there is room", async () => {
    await setLimits({ max_assets: 3 });
    expect((await CREATE_ASSET(request("POST", { name: "Within" }))).status).toBe(201);
  });

  it("is refused with a 402 once the cap is reached", async () => {
    await setLimits({ max_assets: 1 });
    await createAsset(ctx, { name: "The only one" });

    const res = await CREATE_ASSET(request("POST", { name: "One too many" }));
    expect(res.status).toBe(402);

    const body = await res.json() as { type: string; detail: string };
    expect(body.type).toContain("plan-limit");
    expect(body.detail).toMatch(/1 assets/);
  });

  it("never refuses a read, however far over the limit they are", async () => {
    // The rule this whole feature is built around. A customer over their cap
    // must always be able to get at what they already have.
    await setLimits({ max_assets: 1 });
    await createAsset(ctx, { name: "One" });
    await createAsset(ctx, { name: "Two" });
    await createAsset(ctx, { name: "Three" });

    const res = await LIST_ASSETS(request("GET"));
    expect(res.status).toBe(200);
    expect((await res.json() as { data: unknown[] }).data.length).toBe(3);
  });
});

describe("importing against a limit", () => {
  it("refuses a commit that would cross the cap, writing none of it", async () => {
    // Half an import is the worst outcome: the customer cannot tell what
    // landed, and re-running double-imports the part that did.
    await setLimits({ max_assets: 2 });

    const res = await IMPORT(upload(false));
    expect(res.status).toBe(402);

    const count = await withTenant(orgId, async (c) =>
      Number((await c.query<{ n: string }>("SELECT count(*) AS n FROM assets")).rows[0].n),
    );
    expect(count).toBe(0);
  });

  it("still previews a file that would not fit", async () => {
    // Previewing is how somebody discovers they need a bigger plan. Refusing
    // the dry run tells them nothing and leaves them guessing.
    await setLimits({ max_assets: 2 });

    const res = await IMPORT(upload(true));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ created: 3 });
  });

  it("commits one that does fit", async () => {
    await setLimits({ max_assets: 10 });
    expect((await IMPORT(upload(false))).status).toBe(201);
  });
});
