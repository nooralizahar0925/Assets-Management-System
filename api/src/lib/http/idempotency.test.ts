import { describe, it, expect, beforeAll, vi } from "vitest";
import { withTenant } from "../db";
import { createOrg } from "@/test/org";
import { systemCtx } from "../jobs/context";
import { withIdempotency } from "./idempotency";
import type { Ctx } from "./handler";

let ctx: Ctx;

beforeAll(async () => {
  ctx = systemCtx(await createOrg("Idempotency Org"));
});

const request = (key?: string) =>
  new Request("http://api.test/api/v1/assets", {
    method: "POST",
    headers: key ? { "idempotency-key": key } : {},
  });

describe("withIdempotency", () => {
  it("runs the handler when no key is supplied", async () => {
    const handler = vi.fn().mockResolvedValue(
      Response.json({ id: "a1" }, { status: 201 }),
    );
    const res = await withIdempotency(request(), ctx, handler);

    expect(handler).toHaveBeenCalledOnce();
    expect(res.status).toBe(201);
  });

  it("replays the first answer instead of doing the work twice", async () => {
    // An integrator whose request timed out will retry. Without this they get
    // two assets and no way to tell which one is real.
    const handler = vi.fn().mockResolvedValue(
      Response.json({ id: "asset-1" }, { status: 201 }),
    );

    const first = await withIdempotency(request("key-alpha"), ctx, handler);
    const second = await withIdempotency(request("key-alpha"), ctx, handler);

    expect(handler).toHaveBeenCalledOnce();
    expect(second.status).toBe(first.status);
    expect(await second.json()).toEqual({ id: "asset-1" });
  });

  it("marks a replay, so a client can tell it was not fresh work", async () => {
    const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    await withIdempotency(request("key-marked"), ctx, handler);
    const replay = await withIdempotency(request("key-marked"), ctx, handler);

    expect(replay.headers.get("idempotent-replay")).toBe("true");
  });

  it("treats different keys as different work", async () => {
    const handler = vi.fn()
      .mockResolvedValueOnce(Response.json({ id: "one" }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ id: "two" }, { status: 201 }));

    await withIdempotency(request("key-one"), ctx, handler);
    const second = await withIdempotency(request("key-two"), ctx, handler);

    expect(handler).toHaveBeenCalledTimes(2);
    expect(await second.json()).toEqual({ id: "two" });
  });

  it("keeps one organisation's keys away from another's", async () => {
    // The key is chosen by the caller: two tenants will collide on "1" sooner
    // or later, and one must never receive the other's response.
    const other = systemCtx(await createOrg("Other Idempotency Org"));

    await withIdempotency(request("shared"), ctx, vi.fn()
      .mockResolvedValue(Response.json({ tenant: "first" }, { status: 201 })));
    const res = await withIdempotency(request("shared"), other, vi.fn()
      .mockResolvedValue(Response.json({ tenant: "second" }, { status: 201 })));

    expect(await res.json()).toEqual({ tenant: "second" });
  });

  it("does not remember a failure, so a retry can still succeed", async () => {
    // Storing a 500 would make a transient outage permanent for that key.
    const failing = vi.fn().mockResolvedValue(
      Response.json({ error: "nope" }, { status: 500 }),
    );
    await withIdempotency(request("key-fails"), ctx, failing);

    const succeeding = vi.fn().mockResolvedValue(
      Response.json({ id: "recovered" }, { status: 201 }),
    );
    const res = await withIdempotency(request("key-fails"), ctx, succeeding);

    expect(succeeding).toHaveBeenCalledOnce();
    expect(await res.json()).toEqual({ id: "recovered" });
  });

  it("forgets a key once it is older than a day", async () => {
    const handler = vi.fn()
      .mockResolvedValueOnce(Response.json({ id: "old" }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ id: "new" }, { status: 201 }));

    await withIdempotency(request("key-stale"), ctx, handler);
    await withTenant(ctx.orgId, (c) =>
      c.query(
        `UPDATE idempotency_keys SET created_at = now() - interval '25 hours'
          WHERE org_id = $1 AND key = $2`,
        [ctx.orgId, "key-stale"],
      ),
    );

    const res = await withIdempotency(request("key-stale"), ctx, handler);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(await res.json()).toEqual({ id: "new" });
  });

  it("rejects a key too long to be a sensible identifier", async () => {
    const handler = vi.fn();
    const res = await withIdempotency(request("k".repeat(300)), ctx, handler);

    expect(res.status).toBe(422);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("through a real write endpoint", () => {
  it("creates one asset however many times the request is retried", async () => {
    // The unit tests above use a stub handler, so they would pass even if no
    // route ever called withIdempotency. This is the behaviour integrators
    // actually depend on.
    const { createUserWithRole } = await import("@/test/org");
    const { createSession } = await import("@/lib/auth/session");
    const { POST } = await import("@/app/api/v1/assets/route");

    const user = await createUserWithRole(ctx.orgId, "Manager");
    const session = await createSession(user.id, ctx.orgId);

    const send = () => POST(new Request("http://api.test/api/v1/assets", {
      method: "POST",
      headers: {
        cookie: `ams_session=${session}`,
        "content-type": "application/json",
        origin: "http://api.test",
        "idempotency-key": "integration-retry-1",
      },
      body: JSON.stringify({ name: "Retried laptop" }),
    }));

    const first = await send();
    const second = await send();

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers.get("idempotent-replay")).toBe("true");

    const created = (await first.json()) as { id: string };
    const replayed = (await second.json()) as { id: string };
    expect(replayed.id).toBe(created.id);

    const rows = await withTenant(ctx.orgId, async (c) =>
      (await c.query("SELECT 1 FROM assets WHERE name = 'Retried laptop'")).rowCount,
    );
    expect(rows).toBe(1);
  });
});
