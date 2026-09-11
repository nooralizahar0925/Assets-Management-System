import { describe, it, expect, beforeAll } from "vitest";
import { withTenant } from "../db";
import { withPlatform } from "./db";
import { createOrg, createUserWithRole } from "../../test/org";
import { PERMISSIONS, type PermissionKey } from "../auth/permissions";
import type { Ctx } from "../http/handler";
import { createAsset } from "../domain/assets";
import { orgUsage } from "./usage";

/**
 * What a customer holds, counted the same way the limits are enforced.
 *
 * Two different numbers for the same question is how an operator comes to
 * distrust the screen, so "1,284 of 5,000" on the console has to be the same
 * 1,284 that decides whether the next write is refused.
 */

let orgId: string;
let ctx: Ctx;

beforeAll(async () => {
  orgId = await createOrg("Usage Org");
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

describe("what a customer holds", () => {
  it("counts their assets and their people", async () => {
    await createAsset(ctx, { name: "Counted one" });
    await createAsset(ctx, { name: "Counted two" });

    const usage = await orgUsage(orgId);
    expect(usage.assets).toBeGreaterThanOrEqual(2);
    expect(usage.users).toBeGreaterThanOrEqual(1);
  });

  it("counts only live assets, as the limit does", async () => {
    const doomed = await createAsset(ctx, { name: "Deleted later" });
    const before = (await orgUsage(orgId)).assets;

    await withTenant(orgId, (c) =>
      c.query("UPDATE assets SET deleted_at = now() WHERE id = $1", [doomed.id]),
    );

    expect((await orgUsage(orgId)).assets).toBe(before - 1);
  });

  it("counts an invitation nobody has accepted yet", async () => {
    // It holds a seat: somebody is about to be a user, and the limit counts
    // them, so the console has to show them too.
    const before = (await orgUsage(orgId)).pending_invitations;

    const roleId = await withTenant(orgId, async (c) =>
      (await c.query<{ id: string }>(
        "SELECT id FROM roles WHERE lower(name) = 'viewer'",
      )).rows[0].id,
    );
    await withTenant(orgId, (c) =>
      c.query(
        `INSERT INTO user_invitations
           (org_id, email, name, role_id, token_hash, expires_at)
         VALUES ($1, $2, 'Pending', $3, $4, now() + interval '72 hours')`,
        [orgId, `usage-${Date.now()}@invite.test`, roleId, `hash-${Date.now()}`],
      ),
    );

    expect((await orgUsage(orgId)).pending_invitations).toBe(before + 1);
  });

  it("reports storage without being able to read what is stored", async () => {
    // A column grant is exactly the right size of hole: the megabytes are
    // readable, the filenames and object keys are not.
    const usage = await orgUsage(orgId);
    expect(usage.storage_mb).toBeGreaterThanOrEqual(0);

    await expect(
      withPlatform((c) => c.query("SELECT * FROM attachments LIMIT 1")),
    ).rejects.toThrow(/permission denied/i);
  });

  it("rounds storage up, so nobody looks inside a limit they have passed", async () => {
    // A customer 1.2 MB into a 1 MB allowance is over it.
    const asset = await createAsset(ctx, { name: "Has a file" });
    await withTenant(orgId, (c) =>
      c.query(
        `INSERT INTO attachments
           (org_id, asset_id, filename, content_type, size_bytes, object_key)
         VALUES ($1, $2, 'photo.jpg', 'image/jpeg', $3, $4)`,
        [orgId, asset.id, 1_100_000, `key-${Date.now()}`],
      ),
    );

    expect((await orgUsage(orgId)).storage_mb).toBeGreaterThanOrEqual(2);
  });

  it("says zero for a customer who has nothing, rather than failing", async () => {
    const empty = await createOrg("Empty Usage Org");
    expect(await orgUsage(empty)).toMatchObject({
      assets: 0, users: 0, pending_invitations: 0, storage_mb: 0,
    });
  });
});
