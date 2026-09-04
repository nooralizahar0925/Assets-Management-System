import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { withTenant } from "../db";
import { createOrg, createUserWithRole } from "../../test/org";
import { PERMISSIONS, type PermissionKey } from "../auth/permissions";
import type { Ctx } from "../http/handler";
import { createAsset, getAsset, updateAsset } from "./assets";
import {
  checkOut, checkIn, addNote, listAssignments,
  TransitionError, AssetNotFoundError,
} from "./assignments";

let orgId: string;
let userId: string;
let ctx: Ctx;

beforeAll(async () => {
  orgId = await createOrg("Assignment Org");
  const ops = await createUserWithRole(orgId, "Manager", { name: "Ops" });
  userId = ops.id;
  ctx = {
    orgId,
    actor: {
      type: "user", id: userId, label: "Ops", scopes: ["admin"],
      permissions: PERMISSIONS.map((p) => p.key) as PermissionKey[],
      locationScope: null,
    },
  };
});

const newAsset = (name: string) => createAsset(ctx, { name });

const auditFor = (assetId: string) =>
  withTenant(orgId, async (c) =>
    (await c.query<{ event: string; note: string | null }>(
      "SELECT event, note FROM audit_events WHERE asset_id = $1", [assetId],
    )).rows,
  );

describe("checkOut", () => {
  it("moves the asset to in_use and records the assignee", async () => {
    const asset = await newAsset("Drill");
    await checkOut(ctx, asset.id, { assignee_type: "user", assignee_id: userId });
    const after = await getAsset(ctx, asset.id);
    expect(after!.status).toBe("in_use");
    expect(after!.assignee_id).toBe(userId);
  });

  it("writes an asset.checked_out audit event", async () => {
    const asset = await newAsset("Ladder");
    await checkOut(ctx, asset.id, { assignee_type: "user", assignee_id: userId });
    expect((await auditFor(asset.id)).map((r) => r.event)).toContain("asset.checked_out");
  });

  it("refuses to check out an asset that is already out", async () => {
    const asset = await newAsset("Van");
    await checkOut(ctx, asset.id, { assignee_type: "user", assignee_id: userId });
    await expect(
      checkOut(ctx, asset.id, { assignee_type: "user", assignee_id: userId }),
    ).rejects.toBeInstanceOf(TransitionError);
  });

  it("refuses to check out a retired asset", async () => {
    const asset = await newAsset("Old server");
    await updateAsset(ctx, asset.id, { status: "retired" });
    await expect(
      checkOut(ctx, asset.id, { assignee_type: "user", assignee_id: userId }),
    ).rejects.toThrow(/retired/);
  });

  it("allows an asset in maintenance to go straight back out", async () => {
    const asset = await newAsset("Serviced pump");
    await updateAsset(ctx, asset.id, { status: "maintenance" });
    await expect(
      checkOut(ctx, asset.id, { assignee_type: "user", assignee_id: userId }),
    ).resolves.toBeDefined();
  });

  it("distinguishes a missing asset from a bad transition", async () => {
    // A missing asset is 404, not 409 - conflating them tells an integrator to
    // resolve a conflict that does not exist.
    await expect(
      checkOut(ctx, randomUUID(), { assignee_type: "user", assignee_id: userId }),
    ).rejects.toBeInstanceOf(AssetNotFoundError);
  });

  it("supports checking out to a location instead of a person", async () => {
    const locationId = await withTenant(orgId, async (c) =>
      (await c.query<{ id: string }>(
        "INSERT INTO locations (org_id, name) VALUES ($1,'Site B') RETURNING id", [orgId],
      )).rows[0].id,
    );
    const asset = await newAsset("Compressor");
    const assignment = await checkOut(ctx, asset.id, {
      assignee_type: "location", location_id: locationId,
    });
    expect(assignment.assignee_type).toBe("location");
    expect((await getAsset(ctx, asset.id))!.location_id).toBe(locationId);
  });

  it("supports an external assignee with a due date", async () => {
    const asset = await newAsset("Licensed video");
    const assignment = await checkOut(ctx, asset.id, {
      assignee_type: "external", assignee_label: "Acme Agency",
      due_at: "2026-12-31T00:00:00Z",
    });
    expect(assignment.assignee_label).toBe("Acme Agency");
    expect(assignment.due_at).not.toBeNull();
  });

  it("defaults the assignment kind to internal, leaving the rental columns unused", async () => {
    // Spec 11: the columns exist so rental does not need a migration later.
    // Nothing in the MVP writes them.
    const asset = await newAsset("Future rental");
    const assignment = await checkOut(ctx, asset.id, {
      assignee_type: "external", assignee_label: "Someone",
    });
    const row = await withTenant(orgId, async (c) =>
      (await c.query<{ kind: string; party_id: string | null; charge_total: string | null }>(
        "SELECT kind, party_id, charge_total FROM assignments WHERE id = $1",
        [assignment.id],
      )).rows[0],
    );
    expect(row.kind).toBe("internal");
    expect(row.party_id).toBeNull();
    expect(row.charge_total).toBeNull();
  });
});

describe("checkIn", () => {
  it("returns the asset to available and clears the assignee", async () => {
    const asset = await newAsset("Projector");
    await checkOut(ctx, asset.id, { assignee_type: "user", assignee_id: userId });
    await checkIn(ctx, asset.id, { note: "returned intact", condition: "good" });
    const after = await getAsset(ctx, asset.id);
    expect(after!.status).toBe("available");
    expect(after!.assignee_id).toBeNull();
  });

  it("closes the open assignment with a timestamp", async () => {
    const asset = await newAsset("Camera");
    await checkOut(ctx, asset.id, { assignee_type: "user", assignee_id: userId });
    const assignment = await checkIn(ctx, asset.id, {});
    expect(assignment.checked_in_at).not.toBeNull();
  });

  it("records the condition on return", async () => {
    const asset = await newAsset("Chainsaw");
    await checkOut(ctx, asset.id, { assignee_type: "user", assignee_id: userId });
    const assignment = await checkIn(ctx, asset.id, { condition: "blade blunt" });
    expect(assignment.condition).toBe("blade blunt");
  });

  it("refuses to check in an asset that is not checked out", async () => {
    const asset = await newAsset("Idle scanner");
    await expect(checkIn(ctx, asset.id, {})).rejects.toBeInstanceOf(TransitionError);
  });

  it("allows the same asset to cycle out and back repeatedly", async () => {
    const asset = await newAsset("Trolley");
    for (let i = 0; i < 3; i++) {
      await checkOut(ctx, asset.id, { assignee_type: "user", assignee_id: userId });
      await checkIn(ctx, asset.id, {});
    }
    expect(await listAssignments(ctx, asset.id)).toHaveLength(3);
  });

  it("keeps every past assignment, newest first", async () => {
    const asset = await newAsset("Historic");
    await checkOut(ctx, asset.id, { assignee_type: "external", assignee_label: "First" });
    await checkIn(ctx, asset.id, {});
    await checkOut(ctx, asset.id, { assignee_type: "external", assignee_label: "Second" });

    const history = await listAssignments(ctx, asset.id);
    expect(history.map((a) => a.assignee_label)).toEqual(["Second", "First"]);
    expect(history[0].checked_in_at).toBeNull();
    expect(history[1].checked_in_at).not.toBeNull();
  });
});

describe("addNote", () => {
  it("records a free-text note against the asset", async () => {
    const asset = await newAsset("Annotated");
    await expect(addNote(ctx, asset.id, "Screen has a scratch")).resolves.toBe(true);
    const note = (await auditFor(asset.id)).find((r) => r.event === "asset.note");
    expect(note?.note).toBe("Screen has a scratch");
  });

  it("returns false for an unknown asset", async () => {
    await expect(addNote(ctx, randomUUID(), "nobody")).resolves.toBe(false);
  });
});
