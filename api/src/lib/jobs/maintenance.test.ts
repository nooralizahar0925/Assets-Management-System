import { describe, it, expect, beforeAll } from "vitest";
import { withTenant } from "@/lib/db";
import { createOrg, createUserWithRole } from "@/test/org";
import { systemCtx } from "@/lib/jobs/context";
import { createAsset } from "@/lib/domain/assets";
import { createCategory } from "@/lib/domain/categories";
import { createSchedule, completeService } from "@/lib/domain/maintenance";
import { runMaintenanceJob } from "./maintenance";
import { runExpiryJobs } from "./expiring";
import type { Ctx } from "@/lib/http/handler";

let ctx: Ctx;
let assetId: string;
/** Custom values are discarded without a category that declares them. */
let plantId: string;

const today = () => new Date().toISOString().slice(0, 10);

const notices = (id: string) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query(
      `SELECT 1 FROM audit_events
        WHERE asset_id = $1 AND event = 'maintenance.due.notified'`,
      [id],
    )).rowCount ?? 0,
  );

beforeAll(async () => {
  const orgId = await createOrg("Maintenance Job Org");
  await createUserWithRole(orgId, "Administrator");
  ctx = systemCtx(orgId);

  assetId = (await createAsset(ctx, { name: "Sweep forklift" })).id;

  plantId = (await createCategory(ctx, {
    name: "Plant", kind: "equipment",
    field_schema: {
      fields: [
        { key: "next_service_at", label: "Next service", type: "date",
          required: false },
      ],
    },
  })).id;
});

describe("runMaintenanceJob", () => {
  it("notifies once for a schedule that has come due", async () => {
    await createSchedule(ctx, {
      asset_id: assetId, description: "Due now", every_days: 90,
      next_due_at: today(),
    });

    const first = await runMaintenanceJob(ctx);
    expect(first.notified).toBe(1);
    expect(await notices(assetId)).toBe(1);
  });

  it("does not chase the same schedule again the next night", async () => {
    // A notice repeated every evening for a fortnight teaches people to filter
    // it, and then the one that matters is filtered too.
    const second = await runMaintenanceJob(ctx);
    expect(second.notified).toBe(0);
    expect(await notices(assetId)).toBe(1);
  });

  it("leaves a schedule alone until its date approaches", async () => {
    const quiet = await createAsset(ctx, { name: "Not due yet" });
    await createSchedule(ctx, {
      asset_id: quiet.id, description: "Far off", every_days: 365,
    });

    await runMaintenanceJob(ctx);
    expect(await notices(quiet.id)).toBe(0);
  });

  it("stops chasing once the service is recorded", async () => {
    const asset = await createAsset(ctx, { name: "Gets serviced" });
    const schedule = await createSchedule(ctx, {
      asset_id: asset.id, description: "Serviced soon", every_days: 30,
      next_due_at: today(),
    });

    await completeService(ctx, schedule.id, { at: today() });

    const run = await runMaintenanceJob(ctx);
    expect(run.notified).toBe(0);
  });
});

describe("schedules and the next_service_at field", () => {
  it("leaves the custom-field sweep to assets with no schedule of their own", async () => {
    // Both would otherwise chase the same asset, and the one-off field keeps
    // pointing at a past date after every service.
    const asset = await createAsset(ctx, {
      name: "Has both", category_id: plantId,
      custom: { next_service_at: today() },
    });
    await createSchedule(ctx, {
      asset_id: asset.id, description: "Real schedule", every_days: 90,
    });

    const before = await notices(asset.id);
    await runExpiryJobs(ctx);
    expect(await notices(asset.id)).toBe(before);
  });

  it("still chases an asset that has only the custom field", async () => {
    const asset = await createAsset(ctx, {
      name: "Field only", category_id: plantId,
      custom: { next_service_at: today() },
    });

    await runExpiryJobs(ctx);
    expect(await notices(asset.id)).toBe(1);
  });
});
