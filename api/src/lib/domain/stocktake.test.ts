import { describe, it, expect, beforeAll } from "vitest";
import { withTenant } from "@/lib/db";
import { createOrg, createUserWithRole } from "@/test/org";
import { systemCtx } from "@/lib/jobs/context";
import { createLocation } from "./locations";
import { createAsset, getAsset } from "./assets";
import {
  openSession, countAsset, reconcile, closeSession, getSession,
  SessionClosedError,
} from "./stocktake";
import type { Ctx } from "@/lib/http/handler";

let ctx: Ctx;
let warehouse: string;
let office: string;

/** Three assets in the warehouse, one in the office. */
let tagA: string;
let tagB: string;
let tagC: string;
let tagOffice: string;
let assetA: string;
let assetB: string;

const tagOf = async (id: string) => (await getAsset(ctx, id))!.asset_tag;

beforeAll(async () => {
  const orgId = await createOrg("Stocktake Org");
  await createUserWithRole(orgId, "Administrator");
  ctx = systemCtx(orgId);

  warehouse = (await createLocation(ctx, { name: "Warehouse" })).id;
  office = (await createLocation(ctx, { name: "Office" })).id;

  const a = await createAsset(ctx, { name: "Forklift A", location_id: warehouse });
  const b = await createAsset(ctx, { name: "Forklift B", location_id: warehouse });
  const c = await createAsset(ctx, { name: "Pallet truck", location_id: warehouse });
  const o = await createAsset(ctx, { name: "Office laptop", location_id: office });

  assetA = a.id;
  assetB = b.id;
  tagA = await tagOf(a.id);
  tagB = await tagOf(b.id);
  tagC = await tagOf(c.id);
  tagOffice = await tagOf(o.id);
});

describe("openSession", () => {
  it("records what the register expected to be there", async () => {
    // Captured at open time on purpose: an asset legitimately moved during the
    // count would otherwise read as missing.
    const session = await openSession(ctx, {
      location_id: warehouse, name: "Q1 warehouse count",
    });
    expect(session.status).toBe("open");
    expect(session.expected_ids).toHaveLength(3);
  });

  it("counts only the chosen location", async () => {
    const session = await openSession(ctx, { location_id: office, name: "Office" });
    expect(session.expected_ids).toHaveLength(1);
  });
});

describe("countAsset", () => {
  let sessionId: string;

  beforeAll(async () => {
    sessionId = (await openSession(ctx, {
      location_id: warehouse, name: "Counting",
    })).id;
  });

  it("recognises an asset the register expected here", async () => {
    const result = await countAsset(ctx, sessionId, tagA);
    expect(result.outcome).toBe("expected");
    expect(result.asset?.id).toBe(assetA);
  });

  it("reports a second scan of the same asset rather than failing", async () => {
    // Someone counting two hundred items will rescan. That is not an error and
    // must not surface as a unique-constraint violation.
    const result = await countAsset(ctx, sessionId, tagA);
    expect(result.outcome).toBe("already_counted");
  });

  it("records an asset found here that the register placed elsewhere", async () => {
    const result = await countAsset(ctx, sessionId, tagOffice);
    expect(result.outcome).toBe("unexpected");

    const lines = await withTenant(ctx.orgId, async (c) =>
      (await c.query("SELECT 1 FROM stocktake_lines WHERE session_id = $1 AND asset_id IS NOT NULL",
        [sessionId])).rowCount,
    );
    expect(lines).toBe(2);
  });

  it("keeps a tag that matches nothing, as evidence rather than a dropped scan", async () => {
    const result = await countAsset(ctx, sessionId, "NOT-A-TAG");
    expect(result.outcome).toBe("unknown_tag");

    const kept = await withTenant(ctx.orgId, async (c) =>
      (await c.query<{ scanned_tag: string }>(
        "SELECT scanned_tag FROM stocktake_lines WHERE session_id = $1 AND asset_id IS NULL",
        [sessionId],
      )).rows,
    );
    expect(kept.map((r) => r.scanned_tag)).toEqual(["NOT-A-TAG"]);
  });
});

describe("reconcile", () => {
  it("lists what was expected, found, missing and unexpected", async () => {
    const session = await openSession(ctx, {
      location_id: warehouse, name: "Reconciling",
    });
    await countAsset(ctx, session.id, tagA);
    await countAsset(ctx, session.id, tagOffice);

    const result = await reconcile(ctx, session.id);
    expect(result.expected).toBe(3);
    expect(result.counted).toBe(2);
    expect(result.missing).toHaveLength(2);
    expect(result.missing.map((m) => m.id)).toContain(assetB);
    expect(result.missing.map((m) => m.name)).toContain("Pallet truck");
    expect(result.unexpected).toHaveLength(1);
    expect(result.unexpected[0].name).toBe("Office laptop");
  });
});

describe("closeSession", () => {
  it("closes without touching the register when told not to adjust", async () => {
    const session = await openSession(ctx, {
      location_id: warehouse, name: "No adjustment",
    });
    await countAsset(ctx, session.id, tagA);

    await closeSession(ctx, session.id, { adjust: false });

    expect((await getSession(ctx, session.id))!.status).toBe("closed");
    expect((await getAsset(ctx, assetB))!.status).toBe("available");
  });

  it("marks the missing assets lost when told to adjust", async () => {
    const session = await openSession(ctx, {
      location_id: warehouse, name: "With adjustment",
    });
    await countAsset(ctx, session.id, tagA);
    await countAsset(ctx, session.id, tagC);

    const result = await closeSession(ctx, session.id, { adjust: true });

    expect(result.adjusted).toBe(1);
    expect((await getAsset(ctx, assetB))!.status).toBe("lost");
    // Counted assets are untouched.
    expect((await getAsset(ctx, assetA))!.status).toBe("available");
  });

  it("writes an audit event per adjusted asset, so the change is traceable", async () => {
    const events = await withTenant(ctx.orgId, async (c) =>
      (await c.query<{ event: string }>(
        "SELECT event FROM audit_events WHERE asset_id = $1 AND event = 'asset.stocktake_lost'",
        [assetB],
      )).rows,
    );
    expect(events.length).toBeGreaterThan(0);
  });

  it("refuses to count into a session that has been closed", async () => {
    const session = await openSession(ctx, {
      location_id: office, name: "Closed already",
    });
    await closeSession(ctx, session.id, { adjust: false });

    await expect(countAsset(ctx, session.id, tagOffice))
      .rejects.toBeInstanceOf(SessionClosedError);
  });

  it("refuses to close a session twice, so an adjustment cannot run again", async () => {
    const session = await openSession(ctx, {
      location_id: office, name: "Double close",
    });
    await closeSession(ctx, session.id, { adjust: false });

    await expect(closeSession(ctx, session.id, { adjust: true }))
      .rejects.toBeInstanceOf(SessionClosedError);
  });
});
