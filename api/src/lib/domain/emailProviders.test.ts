import { describe, it, expect, beforeAll } from "vitest";
import { withTenant } from "../db";
import { createOrg, createUserWithRole } from "../../test/org";
import { PERMISSIONS, type PermissionKey } from "../auth/permissions";
import type { Ctx } from "../http/handler";
import {
  listProviders, createProvider, updateProvider, deleteProvider,
  getActiveProviders, recordProviderResult,
  DuplicateProviderError, InvalidProviderConfigError,
} from "./emailProviders";

let orgId: string;
let ctx: Ctx;

const sendgrid = (name: string, priority = 100) => ({
  name, type: "sendgrid" as const, from_email: "ams@example.com",
  from_name: "AMS", priority, active: true,
  config: { api_key: "SG.super-secret-value" },
});

beforeAll(async () => {
  orgId = await createOrg("Email Provider Org");
  const admin = await createUserWithRole(orgId, "Administrator");
  ctx = {
    orgId,
    actor: {
      type: "user", id: admin.id, label: "Admin", scopes: ["admin"],
      permissions: PERMISSIONS.map((p) => p.key) as PermissionKey[],
      locationScope: null,
    },
  };
});

describe("createProvider", () => {
  it("stores the provider and returns the secret masked", async () => {
    const created = await createProvider(ctx, sendgrid("Primary"));
    expect(created.type).toBe("sendgrid");
    expect(String(created.config.api_key)).toMatch(/•/);
    expect(String(created.config.api_key)).not.toContain("super-secret-value");
  });

  it("encrypts the secret at rest, so the row never holds plaintext", async () => {
    await createProvider(ctx, sendgrid("At Rest"));
    const raw = await withTenant(orgId, async (c) =>
      (await c.query<{ config: Record<string, unknown> }>(
        "SELECT config FROM email_providers WHERE name = 'At Rest'",
      )).rows[0],
    );
    expect(JSON.stringify(raw.config)).not.toContain("super-secret-value");
    expect(String(raw.config.api_key)).toMatch(/^v1\./);
  });

  it("rejects a config missing a required field", async () => {
    await expect(createProvider(ctx, {
      ...sendgrid("Broken"), config: {},
    })).rejects.toBeInstanceOf(InvalidProviderConfigError);
  });

  it("rejects a duplicate name", async () => {
    await createProvider(ctx, sendgrid("Twice"));
    await expect(createProvider(ctx, sendgrid("Twice")))
      .rejects.toBeInstanceOf(DuplicateProviderError);
  });

  it("validates an smtp config against the smtp schema", async () => {
    await expect(createProvider(ctx, {
      name: "Bad SMTP", type: "smtp", from_email: "a@b.com",
      priority: 100, active: true,
      config: { host: "smtp.example.com" },
    })).rejects.toBeInstanceOf(InvalidProviderConfigError);

    const ok = await createProvider(ctx, {
      name: "Good SMTP", type: "smtp", from_email: "a@b.com",
      priority: 100, active: true,
      config: {
        host: "smtp.example.com", port: 587, secure: false,
        username: "u", password: "hunter2",
      },
    });
    expect(String(ok.config.password)).toMatch(/•/);
    expect(ok.config.host).toBe("smtp.example.com");
  });
});

describe("listProviders", () => {
  it("never returns a plaintext secret", async () => {
    const all = await listProviders(ctx);
    expect(all.length).toBeGreaterThan(0);
    const serialised = JSON.stringify(all);
    expect(serialised).not.toContain("super-secret-value");
    expect(serialised).not.toContain("hunter2");
    // Nor the ciphertext, which would leak the format and length.
    expect(serialised).not.toContain("v1.");
  });

  it("orders by priority", async () => {
    const fresh = await createOrg("Priority Org");
    const freshCtx: Ctx = { ...ctx, orgId: fresh };
    await createProvider(freshCtx, sendgrid("Backup", 200));
    await createProvider(freshCtx, sendgrid("Main", 10));
    expect((await listProviders(freshCtx)).map((p) => p.name)).toEqual(["Main", "Backup"]);
  });
});

describe("getActiveProviders", () => {
  it("decrypts secrets for the sender, best first", async () => {
    const fresh = await createOrg("Active Org");
    const freshCtx: Ctx = { ...ctx, orgId: fresh };
    await createProvider(freshCtx, sendgrid("Second", 200));
    await createProvider(freshCtx, sendgrid("First", 10));

    const active = await getActiveProviders(freshCtx);
    expect(active.map((p) => p.name)).toEqual(["First", "Second"]);
    expect(active[0].config.api_key).toBe("SG.super-secret-value");
  });

  it("omits an inactive provider", async () => {
    const fresh = await createOrg("Inactive Org");
    const freshCtx: Ctx = { ...ctx, orgId: fresh };
    await createProvider(freshCtx, { ...sendgrid("Off"), active: false });
    expect(await getActiveProviders(freshCtx)).toEqual([]);
  });
});

describe("updateProvider", () => {
  it("changes priority without touching the secret", async () => {
    const created = await createProvider(ctx, sendgrid("Repriority", 50));
    const updated = await updateProvider(ctx, created.id, { priority: 5 });
    expect(updated!.priority).toBe(5);

    const active = await getActiveProviders(ctx);
    const found = active.find((p) => p.id === created.id);
    expect(found!.config.api_key).toBe("SG.super-secret-value");
  });

  it("re-seals a replaced config rather than double-encrypting it", async () => {
    const created = await createProvider(ctx, sendgrid("Rotated"));
    await updateProvider(ctx, created.id, {
      config: { api_key: "SG.rotated-value" },
    });
    const active = await getActiveProviders(ctx);
    expect(active.find((p) => p.id === created.id)!.config.api_key)
      .toBe("SG.rotated-value");
  });

  it("returns null for an unknown id", async () => {
    await expect(
      updateProvider(ctx, "00000000-0000-0000-0000-000000000000", { priority: 1 }),
    ).resolves.toBeNull();
  });
});

describe("deleteProvider", () => {
  it("removes a provider", async () => {
    const created = await createProvider(ctx, sendgrid("Doomed"));
    await expect(deleteProvider(ctx, created.id)).resolves.toBe(true);
  });

  it("returns false for an unknown id", async () => {
    await expect(
      deleteProvider(ctx, "00000000-0000-0000-0000-000000000000"),
    ).resolves.toBe(false);
  });
});

describe("recordProviderResult", () => {
  it("stamps verified_at on success and clears the last error", async () => {
    const created = await createProvider(ctx, sendgrid("Verified"));
    await recordProviderResult(ctx, created.id, { ok: false, error: "boom" });
    await recordProviderResult(ctx, created.id, { ok: true });

    const row = (await listProviders(ctx)).find((p) => p.id === created.id)!;
    expect(row.verified_at).not.toBeNull();
    expect(row.last_error).toBeNull();
  });

  it("records the failure so an operator can see why a provider is not sending", async () => {
    const created = await createProvider(ctx, sendgrid("Failing"));
    await recordProviderResult(ctx, created.id, { ok: false, error: "401 bad key" });
    const row = (await listProviders(ctx)).find((p) => p.id === created.id)!;
    expect(row.last_error).toContain("401");
  });
});

describe("tenant isolation", () => {
  it("does not show another organisation's providers", async () => {
    const otherOrg = await createOrg("Other Email Org");
    const otherCtx: Ctx = { ...ctx, orgId: otherOrg };
    await createProvider(otherCtx, sendgrid("Theirs"));

    expect((await listProviders(ctx)).map((p) => p.name)).not.toContain("Theirs");
  });
});
