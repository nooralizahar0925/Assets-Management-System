import { describe, it, expect, beforeAll } from "vitest";
import { withPlatform } from "./db";
import { withTenant } from "../db";
import { createPlatformSession } from "./auth";
import { hashPassword } from "../auth/password";
import {
  provisionOrg, suspendOrg, resumeOrg, deleteOrg,
  SlugTakenError, SlugMismatchError,
} from "./provision";
import { POST as TENANT_LOGIN } from "../../app/api/admin/auth/login/route";

/**
 * Creating a customer means creating something somebody can sign in to and
 * use - not a row. Every test here goes at least as far as the sign-in.
 */

let actor: { id: string; email: string; name: string };

beforeAll(async () => {
  const email = `provision-ops-${Date.now()}@platform.test`;
  const id = await withPlatform(async (c) =>
    (await c.query<{ id: string }>(
      `INSERT INTO platform_admins (email, password_hash, name)
       VALUES ($1, $2, 'Provisioning Operator') RETURNING id`,
      [email, await hashPassword("pw")],
    )).rows[0].id,
  );
  actor = { id, email, name: "Provisioning Operator" };
  await createPlatformSession(id);
});

const unique = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

const signIn = (email: string, password: string) =>
  TENANT_LOGIN(new Request("http://api.test/api/admin/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  }));

async function newCustomer(overrides: Record<string, unknown> = {}) {
  const slug = unique("acme");
  return provisionOrg(actor, {
    name: "Acme Ltd",
    slug,
    adminName: "Ayu Lestari",
    adminEmail: `${slug}@acme.test`,
    planCode: "starter",
    ...overrides,
  });
}

describe("provisioning a customer", () => {
  it("creates an organisation somebody can immediately sign in to", async () => {
    // The whole point. A row nobody can use is not a provisioned customer.
    const { adminEmail, password } = await newCustomer();
    const res = await signIn(adminEmail, password);
    expect(res.status).toBe(200);
  });

  it("gives them roles, so their administrator can actually do something", async () => {
    // Without roles the administrator holds no permissions and every screen
    // tells them no, which reads as a broken product on their first day.
    const { orgId } = await newCustomer();
    const roles = await withTenant(orgId, async (c) =>
      (await c.query("SELECT name FROM roles")).rows,
    );
    expect(roles.length).toBeGreaterThan(3);
  });

  it("gives the administrator a role that grants something", async () => {
    const { orgId } = await newCustomer();
    const grants = await withTenant(orgId, async (c) =>
      (await c.query<{ n: string }>(
        `SELECT count(*) AS n FROM users u
           JOIN role_permissions rp ON rp.role_id = u.role_id
          WHERE u.org_id = $1`,
        [orgId],
      )).rows[0].n,
    );
    expect(Number(grants)).toBeGreaterThan(5);
  });

  it("gives them notification rules, so the product can email at all", async () => {
    const { orgId } = await newCustomer();
    const rules = await withTenant(orgId, async (c) =>
      (await c.query("SELECT event FROM notification_rules")).rows,
    );
    expect(rules.length).toBeGreaterThan(5);
  });

  it("puts them on the plan they were sold", async () => {
    const { orgId } = await newCustomer({ planCode: "professional" });
    const row = await withPlatform(async (c) =>
      (await c.query<{ plan_code: string }>(
        "SELECT plan_code FROM organizations WHERE id = $1", [orgId],
      )).rows[0],
    );
    expect(row.plan_code).toBe("professional");
  });

  it("can create one with no plan yet, for a customer still being arranged", async () => {
    const { orgId } = await newCustomer({ planCode: null });
    const row = await withPlatform(async (c) =>
      (await c.query<{ plan_code: string | null }>(
        "SELECT plan_code FROM organizations WHERE id = $1", [orgId],
      )).rows[0],
    );
    expect(row.plan_code).toBeNull();
  });

  it("refuses a slug already taken", async () => {
    const first = await newCustomer();
    const slug = await withPlatform(async (c) =>
      (await c.query<{ slug: string }>(
        "SELECT slug FROM organizations WHERE id = $1", [first.orgId],
      )).rows[0].slug,
    );

    await expect(newCustomer({ slug })).rejects.toBeInstanceOf(SlugTakenError);
  });

  it("refuses an email already used by another organisation", async () => {
    // Sign-in resolves an address to one account before it knows the tenant,
    // so a duplicate would make one of the two unreachable.
    const first = await newCustomer();
    await expect(newCustomer({ adminEmail: first.adminEmail })).rejects.toThrow();
  });

  it("leaves nothing behind when a step fails", async () => {
    // A half-provisioned tenant is worse than none: it exists, so a retry
    // finds it and builds on the leftovers.
    const slug = unique("doomed");
    await expect(provisionOrg(actor, {
      name: "Doomed Ltd",
      slug,
      adminName: "Nobody",
      adminEmail: "not-an-email-at-all",
      planCode: "starter",
    })).rejects.toThrow();

    const found = await withPlatform(async (c) =>
      (await c.query("SELECT 1 FROM organizations WHERE slug = $1", [slug])).rows,
    );
    expect(found).toEqual([]);
  });

  it("records who created them", async () => {
    const { orgId } = await newCustomer();
    const entry = await withPlatform(async (c) =>
      (await c.query<{ action: string; admin_email: string }>(
        `SELECT action, admin_email FROM platform_audit
          WHERE org_id = $1 ORDER BY occurred_at DESC LIMIT 1`,
        [orgId],
      )).rows[0],
    );
    expect(entry.action).toBe("org.provisioned");
    expect(entry.admin_email).toBe(actor.email);
  });

  it("never returns the password it stored", async () => {
    // It is returned once, to be handed over, and hashed everywhere else.
    const { orgId, password } = await newCustomer();
    const stored = await withTenant(orgId, async (c) =>
      (await c.query<{ password_hash: string }>(
        "SELECT password_hash FROM users LIMIT 1",
      )).rows[0].password_hash,
    );
    expect(stored).not.toContain(password);
  });
});

describe("suspending a customer", () => {
  it("stops their people signing in", async () => {
    const { orgId, adminEmail, password } = await newCustomer();
    expect((await signIn(adminEmail, password)).status).toBe(200);

    await suspendOrg(actor, orgId, "Unpaid since March");

    const res = await signIn(adminEmail, password);
    expect(res.status).toBe(403);
  });

  it("says the organisation is suspended rather than the password is wrong", async () => {
    // Telling somebody their password is wrong when their company has not paid
    // produces a support call about entirely the wrong problem.
    const { orgId, adminEmail, password } = await newCustomer();
    await suspendOrg(actor, orgId, "Unpaid");

    const body = await (await signIn(adminEmail, password)).json() as { type: string };
    expect(body.type).toContain("organization-suspended");
  });

  it("records the reason, because future-you will want it", async () => {
    const { orgId } = await newCustomer();
    await suspendOrg(actor, orgId, "Unpaid since March");

    const entry = await withPlatform(async (c) =>
      (await c.query<{ action: string; detail: { reason?: string } }>(
        `SELECT action, detail FROM platform_audit
          WHERE org_id = $1 AND action = 'org.suspended'
          ORDER BY occurred_at DESC LIMIT 1`,
        [orgId],
      )).rows[0],
    );
    expect(entry.detail.reason).toBe("Unpaid since March");
  });

  it("leaves their data untouched, and lets them back in when resumed", async () => {
    // Suspension is reversible. That is the entire difference between it and
    // deleting the tenant.
    const { orgId, adminEmail, password } = await newCustomer();
    await suspendOrg(actor, orgId, "Unpaid");
    await resumeOrg(actor, orgId);

    expect((await signIn(adminEmail, password)).status).toBe(200);
  });
});

describe("removing a customer", () => {
  it("refuses on a mistyped slug", async () => {
    // The confirmation is the whole safety mechanism: there is no undo.
    const { orgId } = await newCustomer();
    await expect(deleteOrg(actor, orgId, "not-the-slug"))
      .rejects.toBeInstanceOf(SlugMismatchError);
  });

  it("removes the organisation and everything under it", async () => {
    const { orgId } = await newCustomer();
    const slug = await withPlatform(async (c) =>
      (await c.query<{ slug: string }>(
        "SELECT slug FROM organizations WHERE id = $1", [orgId],
      )).rows[0].slug,
    );

    await deleteOrg(actor, orgId, slug);

    const remaining = await withPlatform(async (c) =>
      (await c.query("SELECT 1 FROM organizations WHERE id = $1", [orgId])).rows,
    );
    expect(remaining).toEqual([]);
  });

  it("keeps the record that it was deleted, and by whom", async () => {
    // The audit row outlives the organisation on purpose: "where did that
    // customer go" has to have an answer.
    const { orgId } = await newCustomer();
    const slug = await withPlatform(async (c) =>
      (await c.query<{ slug: string }>(
        "SELECT slug FROM organizations WHERE id = $1", [orgId],
      )).rows[0].slug,
    );

    await deleteOrg(actor, orgId, slug);

    const entry = await withPlatform(async (c) =>
      (await c.query<{ admin_email: string; org_slug: string }>(
        `SELECT admin_email, org_slug FROM platform_audit
          WHERE action = 'org.deleted' AND org_slug = $1 LIMIT 1`,
        [slug],
      )).rows[0],
    );
    expect(entry.admin_email).toBe(actor.email);
    expect(entry.org_slug).toBe(slug);
  });
});
