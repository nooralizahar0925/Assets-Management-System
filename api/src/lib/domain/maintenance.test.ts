import { describe, it, expect, beforeAll } from "vitest";
import { createOrg, createUserWithRole } from "@/test/org";
import { systemCtx } from "@/lib/jobs/context";
import { createAsset } from "./assets";
import {
  createSchedule, completeService, reportHours, dueSchedules,
  listSchedules, listServices,
} from "./maintenance";
import type { Ctx } from "@/lib/http/handler";

let ctx: Ctx;
let forkliftId: string;
let vanId: string;

const today = () => new Date().toISOString().slice(0, 10);
const daysFromNow = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  const orgId = await createOrg("Maintenance Org");
  await createUserWithRole(orgId, "Administrator");
  ctx = systemCtx(orgId);

  forkliftId = (await createAsset(ctx, { name: "Forklift 8FG25" })).id;
  vanId = (await createAsset(ctx, { name: "Delivery van" })).id;
});

describe("createSchedule", () => {
  it("schedules on elapsed days", async () => {
    const schedule = await createSchedule(ctx, {
      asset_id: vanId, description: "Annual service", every_days: 365,
    });
    expect(schedule.every_days).toBe(365);
    expect(schedule.next_due_at).toBe(daysFromNow(365));
  });

  it("schedules on running hours", async () => {
    const schedule = await createSchedule(ctx, {
      asset_id: forkliftId, description: "500-hour service",
      every_hours: 500, current_hours: 1200,
    });
    expect(schedule.every_hours).toBe(500);
    expect(schedule.next_due_hours).toBe(1700);
  });

  it("refuses a schedule with neither interval", async () => {
    await expect(createSchedule(ctx, {
      asset_id: vanId, description: "Nothing",
    })).rejects.toThrow();
  });

  it("starts an hour schedule from zero when no reading is given", async () => {
    const schedule = await createSchedule(ctx, {
      asset_id: vanId, description: "From new", every_hours: 250,
    });
    expect(schedule.next_due_hours).toBe(250);
  });
});

describe("dueSchedules", () => {
  it("reports a day schedule once its date arrives", async () => {
    const schedule = await createSchedule(ctx, {
      asset_id: vanId, description: "Due today", every_days: 30,
      next_due_at: today(),
    });
    const due = await dueSchedules(ctx, 0);
    expect(due.map((d) => d.id)).toContain(schedule.id);
  });

  it("looks ahead by the window it is given", async () => {
    const schedule = await createSchedule(ctx, {
      asset_id: vanId, description: "Due in a week", every_days: 30,
      next_due_at: daysFromNow(7),
    });
    expect((await dueSchedules(ctx, 0)).map((d) => d.id)).not.toContain(schedule.id);
    expect((await dueSchedules(ctx, 14)).map((d) => d.id)).toContain(schedule.id);
  });

  it("reports an hour schedule once the meter passes it", async () => {
    const schedule = await createSchedule(ctx, {
      asset_id: forkliftId, description: "Hour service",
      every_hours: 100, current_hours: 950,
    });
    expect((await dueSchedules(ctx, 0)).map((d) => d.id)).not.toContain(schedule.id);

    await reportHours(ctx, schedule.id, 1060);
    expect((await dueSchedules(ctx, 0)).map((d) => d.id)).toContain(schedule.id);
  });

  it("ignores a schedule that has been turned off", async () => {
    const schedule = await createSchedule(ctx, {
      asset_id: vanId, description: "Switched off", every_days: 1,
      next_due_at: today(), active: false,
    });
    expect((await dueSchedules(ctx, 30)).map((d) => d.id)).not.toContain(schedule.id);
  });
});

describe("completeService", () => {
  it("rolls the next date forward from the completion, not the old due date", async () => {
    // A service done three weeks late must not leave the next one three weeks
    // early. Rolling from the previous due date compresses every interval
    // after a single delay.
    const schedule = await createSchedule(ctx, {
      asset_id: vanId, description: "Quarterly", every_days: 90,
      next_due_at: daysFromNow(-21),
    });

    const after = await completeService(ctx, schedule.id, { at: today() });
    expect(after.next_due_at).toBe(daysFromNow(90));
    expect(after.last_service_at).toBe(today());
  });

  it("rolls an hour schedule forward from the reading at service", async () => {
    const schedule = await createSchedule(ctx, {
      asset_id: forkliftId, description: "Hourly roll",
      every_hours: 500, current_hours: 1000,
    });

    const after = await completeService(ctx, schedule.id, {
      at: today(), hours: 1520,
    });
    expect(after.next_due_hours).toBe(2020);
    expect(after.current_hours).toBe(1520);
  });

  it("records the service in the asset's history", async () => {
    const schedule = await createSchedule(ctx, {
      asset_id: vanId, description: "Recorded", every_days: 30,
    });
    await completeService(ctx, schedule.id, {
      at: today(), note: "Oil and filters", cost: 850_000,
    });

    const history = await listServices(ctx, vanId);
    const entry = history.find((h) => h.note === "Oil and filters")!;
    expect(entry).toBeDefined();
    expect(Number(entry.cost)).toBe(850_000);
  });

  it("writes an audit event, so the asset's timeline shows the service", async () => {
    const schedule = await createSchedule(ctx, {
      asset_id: forkliftId, description: "Audited", every_days: 30,
    });
    await completeService(ctx, schedule.id, { at: today() });

    const { withTenant } = await import("@/lib/db");
    const events = await withTenant(ctx.orgId, async (c) =>
      (await c.query(
        "SELECT 1 FROM audit_events WHERE asset_id = $1 AND event = 'asset.serviced'",
        [forkliftId],
      )).rowCount,
    );
    expect(events).toBeGreaterThan(0);
  });
});

describe("listSchedules", () => {
  it("returns an asset's schedules with the asset's name", async () => {
    const schedules = await listSchedules(ctx);
    const mine = schedules.find((s) => s.asset_id === forkliftId);
    expect(mine?.asset_name).toBe("Forklift 8FG25");
  });
});
