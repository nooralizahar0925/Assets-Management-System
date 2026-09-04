import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { createOrg, createUserWithRole } from "../../test/org";
import { PERMISSIONS, type PermissionKey } from "../auth/permissions";
import type { Ctx } from "../http/handler";
import { createAsset, updateAsset } from "./assets";
import { checkOut, checkIn, addNote } from "./assignments";
import { listAssetHistory, diff } from "./audit";

let orgId: string;
let userId: string;
let ctx: Ctx;

beforeAll(async () => {
  orgId = await createOrg("History Org");
  const rina = await createUserWithRole(orgId, "Manager", { name: "Rina" });
  userId = rina.id;
  ctx = {
    orgId,
    actor: {
      type: "user", id: userId, label: "Rina", scopes: ["admin"],
      permissions: PERMISSIONS.map((p) => p.key) as PermissionKey[],
      locationScope: null,
    },
  };
});

describe("listAssetHistory", () => {
  it("returns every event newest first with the actor attached", async () => {
    const asset = await createAsset(ctx, { name: "Tracked laptop" });
    await updateAsset(ctx, asset.id, { name: "Tracked laptop (renamed)" });
    await checkOut(ctx, asset.id, { assignee_type: "user", assignee_id: userId });
    await addNote(ctx, asset.id, "Screen has a scratch");
    await checkIn(ctx, asset.id, { condition: "fair" });

    const history = await listAssetHistory(ctx, asset.id);
    expect(history.map((e) => e.event)).toEqual([
      "asset.checked_in",
      "asset.note",
      "asset.checked_out",
      "asset.updated",
      "asset.created",
    ]);
    expect(history.every((e) => e.actor_label === "Rina")).toBe(true);
  });

  it("carries the note text on a note event", async () => {
    const asset = await createAsset(ctx, { name: "Noted" });
    await addNote(ctx, asset.id, "Serviced 2026-09-01");
    const [event] = await listAssetHistory(ctx, asset.id);
    expect(event.note).toBe("Serviced 2026-09-01");
  });

  it("carries a from/to diff on an update event", async () => {
    const asset = await createAsset(ctx, { name: "Diffed", status: "available" });
    await updateAsset(ctx, asset.id, { status: "maintenance" });
    const [event] = await listAssetHistory(ctx, asset.id);
    expect(event.changes).toMatchObject({
      status: { from: "available", to: "maintenance" },
    });
  });

  it("returns an empty list for an asset with no events", async () => {
    await expect(listAssetHistory(ctx, randomUUID())).resolves.toEqual([]);
  });

  it("honours the limit", async () => {
    const asset = await createAsset(ctx, { name: "Chatty" });
    for (let i = 0; i < 5; i++) await addNote(ctx, asset.id, `note ${i}`);
    expect(await listAssetHistory(ctx, asset.id, 3)).toHaveLength(3);
  });
});

describe("diff", () => {
  it("reports only what changed", () => {
    expect(diff({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual({
      b: { from: 2, to: 3 },
    });
  });

  it("ignores undefined values, which mean 'not supplied'", () => {
    expect(diff({ a: 1 }, { a: undefined })).toEqual({});
  });

  it("treats null and missing as the same absence", () => {
    expect(diff({}, { a: null })).toEqual({});
  });

  it("compares nested objects by value, not identity", () => {
    expect(diff({ c: { x: 1 } }, { c: { x: 1 } })).toEqual({});
    expect(diff({ c: { x: 1 } }, { c: { x: 2 } })).toMatchObject({
      c: { from: { x: 1 }, to: { x: 2 } },
    });
  });
});
