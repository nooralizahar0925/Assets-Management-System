import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { withTenant } from "../db";
import { createOrg, createUserWithRole } from "../../test/org";
import { PERMISSIONS, type PermissionKey } from "../auth/permissions";
import type { Ctx } from "../http/handler";
import { createAsset } from "../domain/assets";
import { createProvider } from "../domain/emailProviders";
import { createRule } from "../notify/rules";
import { createSavedReport, listSavedReports } from "./saved";
import {
  createSchedule, updateSchedule, deleteSchedule, listSchedules,
  isDue, runDueSchedules, type Schedule,
} from "./schedules";
import { __buildRawMime } from "../email/providers/ses";

let orgId: string;
let ctx: Ctx;
let savedId: string;

const schedule = (over: Partial<Schedule> = {}): Schedule => ({
  id: "s", org_id: "o", saved_report_id: "r", format: "pdf", cadence: "daily",
  day_of_week: null, day_of_month: null, hour_utc: 8, recipients: [],
  active: true, last_run_at: null, ...over,
});

const messages = () =>
  withTenant(orgId, async (c) =>
    (await c.query<{
      to_addresses: string[]; attachments: { filename: string }[]; event: string;
    }>(
      "SELECT to_addresses, attachments, event FROM email_messages WHERE event = 'report.scheduled'",
    )).rows,
  );

beforeAll(async () => {
  orgId = await createOrg("Schedule Org");
  const admin = await createUserWithRole(orgId, "Administrator", { name: "Sched" });
  ctx = {
    orgId,
    actor: {
      type: "user", id: admin.id, label: "Sched", scopes: ["admin"],
      permissions: PERMISSIONS.map((p) => p.key) as PermissionKey[],
      locationScope: null,
    },
  };

  await createAsset(ctx, { name: "Scheduled asset", purchase_cost: 1_000_000 });
  await createRule(ctx, {
    event: "report.scheduled", channel: "email", template_key: "report.scheduled",
    recipient_spec: {}, active: true,
  });
  await createProvider(ctx, {
    name: "Sched provider", type: "sendgrid", from_email: "ams@example.com",
    priority: 10, active: true, config: { api_key: "SG.sched" },
  });
  savedId = (await createSavedReport(ctx, {
    name: "Weekly overdue", report_key: "assignments-overdue", params: {},
  })).id;
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await withTenant(orgId, async (c) => {
    await c.query("DELETE FROM email_messages");
    await c.query("DELETE FROM report_schedules");
  });
});

describe("saved reports", () => {
  it("stores a report key with its filter set", async () => {
    const list = await listSavedReports(ctx);
    expect(list[0]).toMatchObject({
      name: "Weekly overdue", report_key: "assignments-overdue",
    });
  });
});

describe("isDue", () => {
  const at = (iso: string) => new Date(iso);

  it("fires a daily schedule at its hour", () => {
    const s = schedule({ cadence: "daily", hour_utc: 8 });
    expect(isDue(s, at("2026-09-03T08:05:00Z"))).toBe(true);
    expect(isDue(s, at("2026-09-03T07:05:00Z"))).toBe(false);
  });

  it("does not fire twice in the same hour", () => {
    const s = schedule({
      cadence: "daily", hour_utc: 8, last_run_at: "2026-09-03T08:01:00Z",
    });
    expect(isDue(s, at("2026-09-03T08:45:00Z"))).toBe(false);
  });

  it("fires again the next day at the same hour", () => {
    const s = schedule({
      cadence: "daily", hour_utc: 8, last_run_at: "2026-09-03T08:01:00Z",
    });
    expect(isDue(s, at("2026-09-04T08:01:00Z"))).toBe(true);
  });

  it("fires a weekly schedule only on its weekday", () => {
    // 2026-09-03 is a Thursday (day 4).
    const s = schedule({ cadence: "weekly", hour_utc: 8, day_of_week: 4 });
    expect(isDue(s, at("2026-09-03T08:05:00Z"))).toBe(true);
    expect(isDue(s, at("2026-09-04T08:05:00Z"))).toBe(false);
  });

  it("fires a monthly schedule only on its day of month", () => {
    const s = schedule({ cadence: "monthly", hour_utc: 6, day_of_month: 1 });
    expect(isDue(s, at("2026-10-01T06:05:00Z"))).toBe(true);
    expect(isDue(s, at("2026-10-02T06:05:00Z"))).toBe(false);
  });

  it("fires a monthly schedule in February, because the day is capped at 28", () => {
    const s = schedule({ cadence: "monthly", hour_utc: 6, day_of_month: 28 });
    expect(isDue(s, at("2027-02-28T06:05:00Z"))).toBe(true);
  });
});

describe("schedule CRUD", () => {
  it("creates, updates and deletes", async () => {
    const created = await createSchedule(ctx, {
      saved_report_id: savedId, format: "xlsx", cadence: "weekly",
      day_of_week: 1, hour_utc: 7, recipients: ["ops@example.com"], active: true,
    });
    expect(created.format).toBe("xlsx");

    const updated = await updateSchedule(ctx, created.id, { hour_utc: 9 });
    expect(updated!.hour_utc).toBe(9);

    expect((await listSchedules(ctx)).length).toBe(1);
    await expect(deleteSchedule(ctx, created.id)).resolves.toBe(true);
  });

  it("requires at least one recipient", async () => {
    await expect(createSchedule(ctx, {
      saved_report_id: savedId, format: "pdf", cadence: "daily",
      hour_utc: 8, recipients: [], active: true,
    })).rejects.toThrow();
  });
});

describe("runDueSchedules", () => {
  it("queues an email with the rendered report attached", async () => {
    await createSchedule(ctx, {
      saved_report_id: savedId, format: "xlsx", cadence: "daily",
      hour_utc: new Date().getUTCHours(),
      recipients: ["ops@example.com"], active: true,
    });
    const result = await runDueSchedules();
    expect(result.delivered).toBeGreaterThan(0);

    const rows = await messages();
    expect(rows[0].to_addresses).toEqual(["ops@example.com"]);
    expect(rows[0].attachments).toHaveLength(1);
    expect(rows[0].attachments[0].filename).toMatch(/\.xlsx$/);
  });

  it("stamps last_run_at so the same hour does not deliver twice", async () => {
    await createSchedule(ctx, {
      saved_report_id: savedId, format: "pdf", cadence: "daily",
      hour_utc: new Date().getUTCHours(),
      recipients: ["ops@example.com"], active: true,
    });
    await runDueSchedules();
    const second = await runDueSchedules();
    expect(second.delivered).toBe(0);
  });

  it("skips an inactive schedule", async () => {
    await createSchedule(ctx, {
      saved_report_id: savedId, format: "csv", cadence: "daily",
      hour_utc: new Date().getUTCHours(),
      recipients: ["ops@example.com"], active: false,
    });
    expect(await runDueSchedules()).toEqual({ delivered: 0 });
  });

  it("skips a schedule whose hour has not arrived", async () => {
    const otherHour = (new Date().getUTCHours() + 5) % 24;
    await createSchedule(ctx, {
      saved_report_id: savedId, format: "pdf", cadence: "daily",
      hour_utc: otherHour, recipients: ["ops@example.com"], active: true,
    });
    expect(await runDueSchedules()).toEqual({ delivered: 0 });
  });
});

describe("SES raw MIME", () => {
  // SES's Simple content shape cannot carry attachments, so a scheduled report
  // would fail on SES only. These assert the raw path is well-formed without
  // reaching AWS.
  const message = {
    to: ["ops@example.com"],
    subject: "Your weekly report",
    html: "<p>Attached.</p>",
    text: "Attached.",
    from: { email: "ams@example.com", name: "AMS" },
    attachments: [{
      filename: "report.pdf",
      content: Buffer.from("%PDF-1.7 fake"),
      contentType: "application/pdf",
    }],
  };

  it("builds a multipart/mixed message with the attachment", () => {
    const mime = __buildRawMime(message).toString("utf8");
    expect(mime).toContain("Content-Type: multipart/mixed");
    expect(mime).toContain("multipart/alternative");
    expect(mime).toContain('Content-Disposition: attachment; filename="report.pdf"');
    expect(mime).toContain("Content-Type: application/pdf");
  });

  it("base64-encodes the attachment rather than inlining bytes", () => {
    const mime = __buildRawMime(message).toString("utf8");
    expect(mime).toContain(Buffer.from("%PDF-1.7 fake").toString("base64"));
    expect(mime).not.toContain("%PDF-1.7 fake");
  });

  it("encodes the subject so a non-ASCII one survives", () => {
    const mime = __buildRawMime({ ...message, subject: "Laporan — Ringkasan" })
      .toString("utf8");
    expect(mime).toContain("Subject: =?UTF-8?B?");
    expect(mime).not.toContain("Subject: Laporan");
  });

  it("closes every boundary it opens", () => {
    const mime = __buildRawMime(message).toString("utf8");
    const boundary = mime.match(/boundary="([^"]+)"/)![1];
    expect(mime.trimEnd().endsWith(`--${boundary}--`)).toBe(true);
  });

  it("uses CRLF line endings, which the MIME spec requires", () => {
    const mime = __buildRawMime(message).toString("utf8");
    expect(mime).toContain("\r\n");
    expect(mime.split("\r\n").length).toBeGreaterThan(10);
  });
});
