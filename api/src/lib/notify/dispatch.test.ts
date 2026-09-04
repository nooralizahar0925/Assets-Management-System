import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { withTenant } from "../db";
import { createOrg, createUserWithRole } from "../../test/org";
import { PERMISSIONS, type PermissionKey } from "../auth/permissions";
import type { Ctx } from "../http/handler";
import { createAsset } from "../domain/assets";
import { checkOut, checkIn } from "../domain/assignments";
import { createRule, seedDefaultRules, listRules } from "./rules";
import { resolveRecipients } from "./recipients";
import { dispatch } from "./dispatch";

let orgId: string;
let ctx: Ctx;
let adminId: string;
let techId: string;
let managerId: string;
let adminEmail: string;
let techEmail: string;
let managerEmail: string;
let assetId: string;

const queued = () =>
  withTenant(orgId, async (c) =>
    (await c.query<{ to_addresses: string[]; subject: string; event: string }>(
      "SELECT to_addresses, subject, event FROM email_messages ORDER BY created_at",
    )).rows,
  );

beforeAll(async () => {
  orgId = await createOrg("Notify Org");
  const admin = await createUserWithRole(orgId, "Administrator", { name: "Admin User" });
  const tech = await createUserWithRole(orgId, "Technician", { name: "Tech User" });
  const manager = await createUserWithRole(orgId, "Manager", { name: "Manager User" });
  adminId = admin.id; techId = tech.id; managerId = manager.id;
  adminEmail = admin.email; techEmail = tech.email; managerEmail = manager.email;

  ctx = {
    orgId,
    actor: {
      type: "user", id: adminId, label: "Admin", scopes: ["admin"],
      permissions: PERMISSIONS.map((p) => p.key) as PermissionKey[],
      locationScope: null,
    },
  };
  assetId = (await createAsset(ctx, { name: "Notified drill" })).id;
});

beforeEach(async () => {
  await withTenant(orgId, async (c) => {
    await c.query("DELETE FROM email_messages");
    await c.query("DELETE FROM notification_rules");
    await c.query("DELETE FROM notification_prefs");
  });
});

describe("resolveRecipients", () => {
  it("resolves a permission to everyone whose role grants it", async () => {
    // roles:write is administrator-only among the seeded roles.
    const out = await resolveRecipients(ctx, { permissions: ["roles:write"] }, {});
    expect(out.map((r) => r.email)).toEqual([adminEmail]);
  });

  it("resolves a permission held by several roles", async () => {
    // custody:write: administrator, manager and technician.
    const out = await resolveRecipients(ctx, { permissions: ["custody:write"] }, {});
    expect(out.map((r) => r.email).sort()).toEqual(
      [adminEmail, techEmail, managerEmail].sort(),
    );
  });

  it("survives a role being renamed, because it keys on capability", async () => {
    await withTenant(orgId, (c) =>
      c.query("UPDATE roles SET name = 'Chief of Everything' WHERE name = 'Administrator'"),
    );
    const out = await resolveRecipients(ctx, { permissions: ["roles:write"] }, {});
    expect(out.map((r) => r.email)).toEqual([adminEmail]);
    await withTenant(orgId, (c) =>
      c.query("UPDATE roles SET name = 'Administrator' WHERE name = 'Chief of Everything'"),
    );
  });

  it("resolves a specific role by id", async () => {
    const roleId = await withTenant(orgId, async (c) =>
      (await c.query<{ id: string }>(
        "SELECT id FROM roles WHERE name = 'Technician'",
      )).rows[0].id,
    );
    const out = await resolveRecipients(ctx, { role_ids: [roleId] }, {});
    expect(out.map((r) => r.email)).toEqual([techEmail]);
  });

  it("resolves the assignee from the event context", async () => {
    const out = await resolveRecipients(ctx, { assignee: true }, { assigneeId: techId });
    expect(out.map((r) => r.email)).toEqual([techEmail]);
  });

  it("resolves the actor from the event context", async () => {
    const out = await resolveRecipients(ctx, { actor: true }, { actorId: managerId });
    expect(out.map((r) => r.email)).toEqual([managerEmail]);
  });

  it("includes literal email addresses", async () => {
    const out = await resolveRecipients(ctx, { emails: ["ops@vendor.com"] }, {});
    expect(out.map((r) => r.email)).toEqual(["ops@vendor.com"]);
  });

  it("deduplicates a user reached by two paths", async () => {
    const out = await resolveRecipients(
      ctx, { permissions: ["roles:write"], user_ids: [adminId] }, {},
    );
    expect(out).toHaveLength(1);
  });

  it("omits a user who has turned the event off", async () => {
    await withTenant(orgId, (c) =>
      c.query(
        `INSERT INTO notification_prefs (user_id, org_id, event, email_enabled)
         VALUES ($1,$2,'asset.overdue',false)`,
        [techId, orgId],
      ),
    );
    const roleId = await withTenant(orgId, async (c) =>
      (await c.query<{ id: string }>(
        "SELECT id FROM roles WHERE name = 'Technician'",
      )).rows[0].id,
    );
    const out = await resolveRecipients(
      ctx, { role_ids: [roleId] }, {}, "asset.overdue",
    );
    expect(out).toHaveLength(0);
  });

  it("never filters a literal address by preference", async () => {
    // Nobody has a preference row for an external contact.
    const out = await resolveRecipients(
      ctx, { emails: ["vendor@example.com"] }, {}, "asset.overdue",
    );
    expect(out).toHaveLength(1);
  });

  it("returns nothing for an empty spec", async () => {
    expect(await resolveRecipients(ctx, {}, {})).toEqual([]);
  });
});

describe("dispatch", () => {
  it("queues an email for each recipient of a matching rule", async () => {
    await createRule(ctx, {
      event: "asset.overdue", channel: "email", template_key: "asset.overdue",
      recipient_spec: { permissions: ["roles:write"] }, active: true,
    });
    const result = await dispatch(ctx, "asset.overdue", {
      asset: { name: "Notified drill", asset_tag: "AMS-000001" },
      assignment: { due_at: "2026-08-01T00:00:00Z" },
    });
    expect(result.queued).toBe(1);

    const rows = await queued();
    expect(rows[0].to_addresses).toEqual([adminEmail]);
    expect(rows[0].subject).toContain("Notified drill");
    expect(rows[0].event).toBe("asset.overdue");
  });

  it("queues nothing when no rule matches the event", async () => {
    expect(await dispatch(ctx, "asset.overdue", { asset: { name: "x" } }))
      .toEqual({ queued: 0 });
  });

  it("skips an inactive rule", async () => {
    await createRule(ctx, {
      event: "asset.overdue", channel: "email", template_key: "asset.overdue",
      recipient_spec: { permissions: ["roles:write"] }, active: false,
    });
    expect(await dispatch(ctx, "asset.overdue", { asset: { name: "x" } }))
      .toEqual({ queued: 0 });
  });

  it("never throws when a template variable is missing", async () => {
    await createRule(ctx, {
      event: "asset.overdue", channel: "email", template_key: "asset.overdue",
      recipient_spec: { permissions: ["roles:write"] }, active: true,
    });
    await expect(dispatch(ctx, "asset.overdue", {})).resolves.toEqual({ queued: 1 });
  });

  it("swallows a failure rather than propagating it to the caller", async () => {
    // A rule pointing at a template that cannot render must not take down the
    // check-out that triggered it.
    await createRule(ctx, {
      event: "asset.overdue", channel: "email", template_key: "no.such.template",
      recipient_spec: { permissions: ["roles:write"] }, active: true,
    });
    await expect(dispatch(ctx, "asset.overdue", {})).resolves.toBeDefined();
  });
});

describe("custody fires notifications", () => {
  it("queues the assignee email on check-out", async () => {
    await createRule(ctx, {
      event: "asset.checked_out", channel: "email",
      template_key: "asset.checked_out",
      recipient_spec: { assignee: true }, active: true,
    });
    await checkOut(ctx, assetId, { assignee_type: "user", assignee_id: techId });

    const rows = (await queued()).filter((r) => r.event === "asset.checked_out");
    expect(rows[0].to_addresses).toEqual([techEmail]);
  });

  it("queues on check-in too", async () => {
    await createRule(ctx, {
      event: "asset.checked_in", channel: "email",
      template_key: "asset.checked_in",
      recipient_spec: { actor: true }, active: true,
    });
    await checkIn(ctx, assetId, { condition: "good" });

    const rows = (await queued()).filter((r) => r.event === "asset.checked_in");
    expect(rows[0].to_addresses).toEqual([adminEmail]);
  });

  it("still completes the check-out when no rule exists", async () => {
    const asset = await createAsset(ctx, { name: "Unnotified" });
    await expect(
      checkOut(ctx, asset.id, { assignee_type: "user", assignee_id: techId }),
    ).resolves.toBeDefined();
    await checkIn(ctx, asset.id, {});
  });
});

describe("seedDefaultRules", () => {
  it("creates one rule per default event and is safe to run twice", async () => {
    await seedDefaultRules(ctx);
    await seedDefaultRules(ctx);
    expect(await listRules(ctx)).toHaveLength(8);
  });

  it("expresses defaults as capabilities, not role names", async () => {
    await seedDefaultRules(ctx);
    const overdue = (await listRules(ctx)).find((r) => r.event === "asset.overdue")!;
    expect(overdue.recipient_spec.permissions).toBeDefined();
    expect(overdue.recipient_spec).not.toHaveProperty("roles");
  });
});
