import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { withTenant } from "@/lib/db";
import { createOrg, createUserWithRole } from "@/test/org";
import { createSession } from "@/lib/auth/session";
import { PERMISSIONS, type PermissionKey } from "@/lib/auth/permissions";
import type { Ctx } from "@/lib/http/handler";
import { createWebhook, WEBHOOK_EVENTS } from "@/lib/domain/webhooks";
// Statically imported: this module pulls in the spreadsheet reader, and loading
// that inside a test body costs more than the test's own timeout.
import { runImport } from "@/lib/domain/imports";
import { POST as createAssetRoute } from "./assets/route";
import { PATCH as patchAssetRoute, DELETE as deleteAssetRoute } from "./assets/[id]/route";

/**
 * Proof that a subscription actually receives something.
 *
 * The source scanner beside `webhooks.ts` proves a dispatch call exists; it
 * cannot prove the call is reached, that the event name matches the one people
 * subscribe to, or that a delivery row is written. Only driving the real route
 * with a real subscription does that - and every one of these events was
 * subscribable and silent before this test was written.
 */

let orgId: string;
let ctx: Ctx;
let session: string;

const deliveredEvents = () =>
  withTenant(orgId, async (c) =>
    (await c.query<{ event: string }>(
      "SELECT event FROM webhook_deliveries ORDER BY created_at",
    )).rows.map((r) => r.event),
  );

const request = (path: string, method: string, body?: unknown) =>
  new Request(`http://api.test${path}`, {
    method,
    headers: { cookie: `ams_session=${session}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeAll(async () => {
  orgId = await createOrg("Webhook Wiring Org");
  const admin = await createUserWithRole(orgId, "Administrator");
  ctx = {
    orgId,
    actor: {
      type: "user", id: admin.id, label: "Admin", scopes: ["admin"],
      permissions: PERMISSIONS.map((p) => p.key) as PermissionKey[],
      locationScope: null,
    },
  };
  session = await createSession(admin.id, orgId);

  // Subscribed to everything, exactly as the settings screen allows.
  await createWebhook(ctx, {
    url: "https://example.test/hook", events: [...WEBHOOK_EVENTS],
  });
});

beforeEach(() =>
  withTenant(orgId, (c) => c.query("DELETE FROM webhook_deliveries")),
);

async function createAsset(name: string): Promise<string> {
  const res = await createAssetRoute(request("/api/v1/assets", "POST", { name }));
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

describe("the register's webhook events", () => {
  it("queues a delivery when an asset is created", async () => {
    await createAsset("Queued Laptop");
    expect(await deliveredEvents()).toEqual(["asset.created"]);
  });

  it("queues a delivery when an asset is changed", async () => {
    const id = await createAsset("Patched Laptop");
    const res = await patchAssetRoute(
      request(`/api/v1/assets/${id}`, "PATCH", { name: "Renamed" }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(200);
    expect(await deliveredEvents()).toContain("asset.updated");
  });

  it("queues a delivery when an asset is deleted", async () => {
    const id = await createAsset("Doomed Laptop");
    const res = await deleteAssetRoute(
      request(`/api/v1/assets/${id}`, "DELETE"),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(204);
    expect(await deliveredEvents()).toContain("asset.deleted");
  });

  it("carries enough of the asset to be useful without a second request", async () => {
    // A payload of nothing but an id forces every subscriber to call back for
    // the name - and for a deletion, the callback would 404.
    await createAsset("Descriptive Laptop");
    const payload = await withTenant(orgId, async (c) =>
      (await c.query<{ payload: { asset?: { name?: string } } }>(
        "SELECT payload FROM webhook_deliveries LIMIT 1",
      )).rows[0].payload,
    );
    expect(payload.asset?.name).toBe("Descriptive Laptop");
  });

  it("does not fan out one delivery per row of an import", async () => {
    // Kept honest here rather than only in the documentation: a thousand-row
    // spreadsheet must not become a thousand deliveries.
    await runImport(ctx, {
      rows: [{ name: "Bulk A" }, { name: "Bulk B" }, { name: "Bulk C" }],
      mapping: { name: "name" },
      categoryId: null,
      dryRun: false,
      filename: "bulk.csv",
    });
    expect(await deliveredEvents()).toEqual([]);
  });
});
