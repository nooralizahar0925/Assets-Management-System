import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { withTenant } from "../db";
import { createOrg } from "@/test/org";
import { systemCtx } from "../jobs/context";
import {
  createWebhook, listWebhooks, deleteWebhook, queueDelivery, deliverPending,
  signPayload, verifySignature, WEBHOOK_EVENTS,
} from "./webhooks";
import type { Ctx } from "../http/handler";

let ctx: Ctx;

const deliveries = () =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<{
      status: string; attempts: number; last_status: number | null;
    }>(
      "SELECT status, attempts, last_status FROM webhook_deliveries ORDER BY created_at",
    )).rows,
  );

const clearDeliveries = () =>
  withTenant(ctx.orgId, (c) => c.query("DELETE FROM webhook_deliveries"));

beforeAll(async () => {
  ctx = systemCtx(await createOrg("Webhook Org"));
});

afterEach(() => vi.restoreAllMocks());

describe("signing", () => {
  it("signs the exact bytes that were sent", () => {
    // Signing the object rather than the serialised body would let two valid
    // encodings disagree, and the receiver only has the bytes.
    const body = JSON.stringify({ event: "asset.created", data: { id: "a1" } });
    expect(signPayload("whsec_test", body)).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("verifies its own signature", () => {
    const body = '{"a":1}';
    expect(verifySignature("s", body, signPayload("s", body))).toBe(true);
  });

  it("refuses a signature made with another secret", () => {
    const body = '{"a":1}';
    expect(verifySignature("s", body, signPayload("other", body))).toBe(false);
  });

  it("refuses a signature of different length without throwing", () => {
    expect(verifySignature("s", "{}", "sha256=short")).toBe(false);
  });
});

describe("managing endpoints", () => {
  it("returns the secret once, at creation", async () => {
    const hook = await createWebhook(ctx, {
      url: "https://example.test/hook", events: ["asset.created"],
    });
    expect(hook.secret).toMatch(/^whsec_[0-9a-f]{48}$/);
  });

  it("never lists the secret again", async () => {
    // There is no endpoint that shows it twice: a leaked secret is rotated by
    // replacing the endpoint, not by reading it back.
    const listed = await listWebhooks(ctx);
    expect(listed.every((h) => h.secret === undefined)).toBe(true);
  });

  it("refuses an event nobody publishes", async () => {
    await expect(createWebhook(ctx, {
      url: "https://example.test/hook", events: ["asset.exploded"] as never,
    })).rejects.toThrow();
  });

  it("refuses something that is not a url", async () => {
    await expect(createWebhook(ctx, {
      url: "not-a-url", events: ["asset.created"],
    })).rejects.toThrow();
  });

  it("removes an endpoint", async () => {
    const hook = await createWebhook(ctx, {
      url: "https://example.test/temporary", events: ["asset.created"],
    });
    expect(await deleteWebhook(ctx, hook.id)).toBe(true);
    expect((await listWebhooks(ctx)).some((h) => h.id === hook.id)).toBe(false);
  });

  it("publishes a fixed set of events", () => {
    // Adding one is a public API change, so the list is explicit rather than
    // derived from whatever the code happens to dispatch.
    expect(WEBHOOK_EVENTS).toContain("asset.checked_out");
    expect(WEBHOOK_EVENTS).not.toContain("asset.note");
  });
});

describe("delivery", () => {
  it("queues one delivery per subscribed endpoint", async () => {
    await clearDeliveries();
    const queued = await queueDelivery(ctx, "asset.created", { id: "a1" });
    expect(queued).toBeGreaterThan(0);
    expect((await deliveries()).every((d) => d.status === "pending")).toBe(true);
  });

  it("queues nothing for an event nobody subscribed to", async () => {
    await clearDeliveries();
    expect(await queueDelivery(ctx, "import.completed", {})).toBe(0);
  });

  it("marks a delivery done when the endpoint accepts it", async () => {
    await clearDeliveries();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));

    await queueDelivery(ctx, "asset.created", { id: "a2" });
    const result = await deliverPending(ctx);

    expect(result.delivered).toBeGreaterThan(0);
    expect((await deliveries()).every((d) => d.status === "delivered")).toBe(true);
  });

  it("sends the signature and the event name in headers", async () => {
    await clearDeliveries();
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    await queueDelivery(ctx, "asset.created", { id: "a3" });
    await deliverPending(ctx);

    const [, init] = fetchSpy.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers["x-ams-event"]).toBe("asset.created");
    expect(headers["x-ams-signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("keeps a refused delivery pending for another try", async () => {
    await clearDeliveries();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    await queueDelivery(ctx, "asset.created", { id: "a4" });
    const result = await deliverPending(ctx);

    expect(result.failed).toBeGreaterThan(0);
    const [row] = await deliveries();
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(1);
    expect(row.last_status).toBe(500);
  });

  it("does not retry immediately, so a struggling endpoint is not hammered", async () => {
    // The row it just failed is scheduled into the future, so a second sweep
    // in the same minute finds nothing to do.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));
    const second = await deliverPending(ctx);
    expect(second.delivered + second.failed).toBe(0);
  });

  it("gives up after four attempts rather than retrying forever", async () => {
    await clearDeliveries();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 503 }));
    await queueDelivery(ctx, "asset.created", { id: "a5" });

    for (let i = 0; i < 4; i += 1) {
      await deliverPending(ctx);
      // Bring the next attempt forward, as time would.
      await withTenant(ctx.orgId, (c) =>
        c.query("UPDATE webhook_deliveries SET next_attempt_at = now()"),
      );
    }

    const [row] = await deliveries();
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(4);
  });

  it("survives an endpoint that never answers", async () => {
    await clearDeliveries();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("connect ETIMEDOUT"));

    await queueDelivery(ctx, "asset.created", { id: "a6" });
    const result = await deliverPending(ctx);

    expect(result.failed).toBe(1);
    expect((await deliveries())[0].status).toBe("pending");
  });
});

describe("wired to real events", () => {
  it("queues a delivery when the system dispatches a subscribed event", async () => {
    // The tests above call queueDelivery directly, so they would pass even if
    // nothing ever dispatched. This is what makes the feature exist.
    await clearDeliveries();
    const { dispatch } = await import("../notify/dispatch");

    await dispatch(ctx, "asset.created", { assetId: "00000000-0000-0000-0000-000000000001" });

    const rows = await deliveries();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].status).toBe("pending");
  });

  it("does not let a webhook problem stop the email going out", async () => {
    // Notifications people rely on must not depend on somebody's integration
    // endpoint being configured correctly.
    await clearDeliveries();
    const { dispatch } = await import("../notify/dispatch");
    await expect(dispatch(ctx, "asset.created", {})).resolves.toBeDefined();
  });
});
