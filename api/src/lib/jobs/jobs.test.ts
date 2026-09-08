import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { withTenant } from "../db";
import { createOrg, createUserWithRole } from "../../test/org";
import { PERMISSIONS, type PermissionKey } from "../auth/permissions";
import type { Ctx } from "../http/handler";
import { createAsset, updateAsset } from "../domain/assets";
import { checkOut } from "../domain/assignments";
import { createCategory } from "../domain/categories";
import { createProvider } from "../domain/emailProviders";
import { createRule } from "../notify/rules";
import { findOverdue, runOverdueJob } from "./overdue";
import { findExpiring, runExpiryJobs } from "./expiring";
import { runAllJobs } from "./runner";

let orgId: string;
let userId: string;
let ctx: Ctx;
let categoryId: string;

const daysFromNow = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const emailCount = (event: string) =>
  withTenant(orgId, async (c) =>
    Number((await c.query<{ n: string }>(
      "SELECT count(*) AS n FROM email_messages WHERE event = $1", [event],
    )).rows[0].n),
  );

beforeAll(async () => {
  orgId = await createOrg("Jobs Org");
  const ops = await createUserWithRole(orgId, "Administrator", { name: "Ops" });
  userId = ops.id;
  ctx = {
    orgId,
    actor: {
      type: "user", id: userId, label: "Ops", scopes: ["admin"],
      permissions: PERMISSIONS.map((p) => p.key) as PermissionKey[],
      locationScope: null,
    },
  };

  categoryId = (await createCategory(ctx, {
    name: "IT", kind: "it",
    field_schema: { fields: [
      { key: "warranty_end", label: "Warranty End", type: "date", required: false },
      { key: "license_expiry", label: "Licence Expiry", type: "date", required: false },
      { key: "next_service_at", label: "Next Service", type: "date", required: false },
    ] },
  })).id;

  for (const event of ["asset.overdue", "warranty.expiring",
                       "licence.expiring", "maintenance.due"] as const) {
    await createRule(ctx, {
      event, channel: "email", template_key: event,
      recipient_spec: { permissions: ["roles:write"] }, active: true,
    });
  }
});

beforeEach(async () => {
  await withTenant(orgId, (c) => c.query("DELETE FROM email_messages"));
});

describe("findOverdue", () => {
  it("finds an open assignment past its due date", async () => {
    const asset = await createAsset(ctx, { name: "Late laptop" });
    await checkOut(ctx, asset.id, {
      assignee_type: "user", assignee_id: userId,
      due_at: "2026-08-01T00:00:00Z",
    });
    const overdue = await findOverdue(ctx);
    expect(overdue.map((o) => o.asset_name)).toContain("Late laptop");
    expect(overdue[0].days_late).toBeGreaterThan(0);
  });

  it("ignores an assignment with no due date", async () => {
    const asset = await createAsset(ctx, { name: "Open-ended" });
    await checkOut(ctx, asset.id, { assignee_type: "user", assignee_id: userId });
    const overdue = await findOverdue(ctx);
    expect(overdue.map((o) => o.asset_name)).not.toContain("Open-ended");
  });

  it("ignores an assignment already checked back in", async () => {
    const asset = await createAsset(ctx, { name: "Returned late" });
    await checkOut(ctx, asset.id, {
      assignee_type: "user", assignee_id: userId, due_at: "2026-08-01T00:00:00Z",
    });
    await withTenant(orgId, (c) =>
      c.query("UPDATE assignments SET checked_in_at = now() WHERE asset_id = $1",
        [asset.id]),
    );
    const overdue = await findOverdue(ctx);
    expect(overdue.map((o) => o.asset_name)).not.toContain("Returned late");
  });

  it("ignores a deleted asset", async () => {
    const asset = await createAsset(ctx, { name: "Deleted late" });
    await checkOut(ctx, asset.id, {
      assignee_type: "user", assignee_id: userId, due_at: "2026-08-01T00:00:00Z",
    });
    await withTenant(orgId, (c) =>
      c.query("UPDATE assets SET deleted_at = now() WHERE id = $1", [asset.id]),
    );
    expect((await findOverdue(ctx)).map((o) => o.asset_name))
      .not.toContain("Deleted late");
  });
});

describe("runOverdueJob", () => {
  it("queues one notification per overdue assignment", async () => {
    const result = await runOverdueJob(ctx);
    expect(result.notified).toBeGreaterThan(0);
    expect(await emailCount("asset.overdue")).toBe(result.notified);
  });

  it("does not notify twice on the same day", async () => {
    // The de-duplication key is an audit marker, not the email row, so clearing
    // the outbox must not cause a second send.
    await withTenant(orgId, (c) => c.query("DELETE FROM email_messages"));
    expect((await runOverdueJob(ctx)).notified).toBe(0);
    expect(await emailCount("asset.overdue")).toBe(0);
  });

  it("notifies again once the marker is older than today", async () => {
    await withTenant(orgId, (c) =>
      c.query(
        `UPDATE audit_events SET created_at = now() - interval '2 days'
          WHERE event = 'asset.overdue_notified'`,
      ),
    );
    expect((await runOverdueJob(ctx)).notified).toBeGreaterThan(0);
  });
});

describe("findExpiring", () => {
  it("finds assets whose custom date falls inside the window", async () => {
    await createAsset(ctx, {
      name: "Expiring warranty", category_id: categoryId,
      custom: { warranty_end: daysFromNow(30) },
    });
    const rows = await findExpiring(ctx, "warranty_end", 90);
    expect(rows.map((r) => r.name)).toContain("Expiring warranty");
  });

  it("ignores a date beyond the window", async () => {
    await createAsset(ctx, {
      name: "Distant warranty", category_id: categoryId,
      custom: { warranty_end: daysFromNow(400) },
    });
    const rows = await findExpiring(ctx, "warranty_end", 90);
    expect(rows.map((r) => r.name)).not.toContain("Distant warranty");
  });

  it("ignores an already-expired date", async () => {
    await createAsset(ctx, {
      name: "Expired warranty", category_id: categoryId,
      custom: { warranty_end: daysFromNow(-10) },
    });
    const rows = await findExpiring(ctx, "warranty_end", 90);
    expect(rows.map((r) => r.name)).not.toContain("Expired warranty");
  });

  it("ignores a retired asset", async () => {
    const asset = await createAsset(ctx, {
      name: "Retired warranty", category_id: categoryId,
      custom: { warranty_end: daysFromNow(30) },
    });
    await updateAsset(ctx, asset.id, { status: "retired" });
    const rows = await findExpiring(ctx, "warranty_end", 90);
    expect(rows.map((r) => r.name)).not.toContain("Retired warranty");
  });

  it("survives a hand-typed date that is not a date", async () => {
    // The regex guard is what stops one bad value aborting the query for every
    // other row.
    await withTenant(orgId, (c) =>
      c.query(
        `INSERT INTO assets (org_id, asset_tag, name, status, custom)
         VALUES ($1, 'BAD-DATE-1', 'Typo warranty', 'available',
                 '{"warranty_end":"soon"}'::jsonb)`,
        [orgId],
      ),
    );
    const rows = await findExpiring(ctx, "warranty_end", 90);
    expect(rows.map((r) => r.name)).not.toContain("Typo warranty");
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe("runExpiryJobs", () => {
  it("reports a count for each of the three date fields", async () => {
    await withTenant(orgId, (c) =>
      c.query("DELETE FROM audit_events WHERE event LIKE '%.notified'"),
    );
    const result = await runExpiryJobs(ctx);
    expect(result).toHaveProperty("warranty");
    expect(result).toHaveProperty("licence");
    expect(result).toHaveProperty("maintenance");
    expect(result.warranty).toBeGreaterThan(0);
  });

  it("does not repeat an expiry notice within the window", async () => {
    // An expiry notice repeated daily for ninety days trains people to ignore it.
    const second = await runExpiryJobs(ctx);
    expect(second.warranty).toBe(0);
  });
});

describe("runAllJobs", () => {
  // runAllJobs walks every organisation in the database, and the shared test
  // database accumulates one per suite, so this needs more than the default.
  it("runs every organisation and drains the outbox", { timeout: 60_000 }, async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 202, headers: { "x-message-id": "sg-job" } }),
    );
    await createProvider(ctx, {
      name: "Jobs provider", type: "sendgrid", from_email: "ams@example.com",
      priority: 10, active: true, config: { api_key: "SG.jobs" },
    });
    await withTenant(orgId, async (c) => {
      await c.query("DELETE FROM audit_events WHERE event LIKE '%.notified'");
      await c.query("DELETE FROM email_messages");
    });

    const summaries = await runAllJobs();
    const mine = summaries.find((s) => s.org_id === orgId);
    expect(mine).toBeDefined();
    expect(mine!.sent).toBeGreaterThan(0);
    vi.restoreAllMocks();
  });

  it("returns a summary per organisation rather than throwing on one", { timeout: 60_000 }, async () => {
    const summaries = await runAllJobs();
    expect(Array.isArray(summaries)).toBe(true);
    for (const s of summaries) expect(s).toHaveProperty("org_id");
  });

  it("records month-end book values as part of the sweep", { timeout: 60_000 }, async () => {
    // The sweep is where depreciation actually happens in production. Without
    // this the job could be unwired from the runner and every other test would
    // still pass.
    const cat = await createCategory(ctx, {
      name: "Depreciating kit", kind: "it", field_schema: { fields: [] },
    });
    await withTenant(orgId, (c) =>
      c.query(
        `UPDATE categories SET depreciation_method = 'straight_line',
                useful_life_months = 24 WHERE id = $1`,
        [cat.id],
      ),
    );
    const asset = await createAsset(ctx, {
      name: "Depreciating laptop", category_id: cat.id,
      purchase_cost: 24_000_000, purchase_date: "2020-01-15",
    });

    await runAllJobs();

    const written = await withTenant(orgId, async (c) =>
      (await c.query<{ n: string }>(
        "SELECT count(*) AS n FROM asset_book_values WHERE asset_id = $1",
        [asset.id],
      )).rows[0],
    );
    // A 24-month life bought in 2020 is fully depreciated by now.
    expect(Number(written.n)).toBe(24);
  });
});
