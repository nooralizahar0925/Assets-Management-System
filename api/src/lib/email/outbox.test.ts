import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { withTenant } from "../db";
import { createOrg, createUserWithRole } from "../../test/org";
import { PERMISSIONS, type PermissionKey } from "../auth/permissions";
import type { Ctx } from "../http/handler";
import { createProvider } from "../domain/emailProviders";
import { enqueue, enqueueTemplated, processOutbox, listMessages } from "./outbox";

let orgId: string;
let ctx: Ctx;

const message = {
  to: ["rina@example.com"],
  subject: "Asset assigned",
  html: "<p>Hello</p>",
  text: "Hello",
};

const row = (id: string) =>
  withTenant(orgId, async (c) =>
    (await c.query<{
      status: string; attempts: number; to_addresses: string[];
      provider_message_id: string | null; sent_at: string | null;
      last_error: string | null; deferred: boolean;
    }>(
      `SELECT status, attempts, to_addresses, provider_message_id, sent_at,
              last_error, scheduled_for > now() AS deferred
         FROM email_messages WHERE id = $1`,
      [id],
    )).rows[0],
  );

beforeAll(async () => {
  orgId = await createOrg("Outbox Org");
  const admin = await createUserWithRole(orgId, "Administrator");
  ctx = {
    orgId,
    actor: {
      type: "user", id: admin.id, label: "Admin", scopes: ["admin"],
      permissions: PERMISSIONS.map((p) => p.key) as PermissionKey[],
      locationScope: null,
    },
  };

  await createProvider(ctx, {
    name: "Primary", type: "sendgrid", from_email: "ams@example.com",
    from_name: "AMS", priority: 10, active: true, config: { api_key: "SG.primary" },
  });
  await createProvider(ctx, {
    name: "Backup", type: "resend", from_email: "ams@example.com",
    from_name: "AMS", priority: 20, active: true, config: { api_key: "re_backup" },
  });
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await withTenant(orgId, (c) => c.query("DELETE FROM email_messages"));
});

describe("enqueue", () => {
  it("stores the message as queued and sends nothing yet", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const id = await enqueue(ctx, message);
    const stored = await row(id);
    expect(stored).toMatchObject({ status: "queued", attempts: 0 });
    expect(stored.to_addresses).toEqual(["rina@example.com"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders a template and queues the result", async () => {
    vi.spyOn(globalThis, "fetch");
    const id = await enqueueTemplated(ctx, "asset.checked_out", ["rina@example.com"], {
      asset: { name: "Dell Latitude", asset_tag: "AMS-000001" },
      user: { name: "Rina" },
    });
    const stored = await withTenant(orgId, async (c) =>
      (await c.query<{ subject: string; template_key: string }>(
        "SELECT subject, template_key FROM email_messages WHERE id = $1", [id],
      )).rows[0],
    );
    expect(stored.template_key).toBe("asset.checked_out");
    expect(stored.subject).toContain("Dell Latitude");
  });
});

describe("processOutbox", () => {
  it("sends a queued message through the highest-priority provider", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 202, headers: { "x-message-id": "sg-9" } }),
    );
    const id = await enqueue(ctx, message);
    await expect(processOutbox(ctx, 10)).resolves.toEqual({ sent: 1, failed: 0 });

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.sendgrid.com/v3/mail/send");
    const stored = await row(id);
    expect(stored).toMatchObject({ status: "sent", provider_message_id: "sg-9" });
    expect(stored.sent_at).not.toBeNull();
  });

  it("falls through to the backup provider when the primary rejects", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("upstream down", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "re-9" }), { status: 200 }));

    const id = await enqueue(ctx, message);
    await expect(processOutbox(ctx, 10)).resolves.toEqual({ sent: 1, failed: 0 });

    expect(fetchMock.mock.calls[1][0]).toBe("https://api.resend.com/emails");
    expect(await row(id)).toMatchObject({
      status: "sent", provider_message_id: "re-9",
    });
  });

  it("re-queues with a backoff when every provider fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));
    const id = await enqueue(ctx, message);
    await expect(processOutbox(ctx, 10)).resolves.toEqual({ sent: 0, failed: 1 });

    const stored = await row(id);
    expect(stored).toMatchObject({ status: "queued", attempts: 1, deferred: true });
    expect(stored.last_error).toContain("500");
  });

  it("gives up after five attempts and marks the message failed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));
    const id = await enqueue(ctx, message);
    await withTenant(orgId, (c) =>
      c.query("UPDATE email_messages SET attempts = 4 WHERE id = $1", [id]),
    );
    await processOutbox(ctx, 10);
    expect((await row(id)).status).toBe("failed");
  });

  it("ignores a message scheduled for the future", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await enqueue(ctx, {
      ...message,
      scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
    });
    await expect(processOutbox(ctx, 10)).resolves.toEqual({ sent: 0, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not send the same message twice across two passes", async () => {
    // The claim marks rows 'sending' before dispatch, so a second worker - or a
    // second pass - finds nothing to do.
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 202, headers: { "x-message-id": "sg-1" } }),
    );
    await enqueue(ctx, message);
    await processOutbox(ctx, 10);
    await processOutbox(ctx, 10);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("records the failure against the provider so an operator can see it", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));
    await enqueue(ctx, message);
    await processOutbox(ctx, 10);

    const providers = await withTenant(orgId, async (c) =>
      (await c.query<{ name: string; last_error: string | null }>(
        "SELECT name, last_error FROM email_providers ORDER BY priority",
      )).rows,
    );
    expect(providers[0].last_error).toContain("500");
  });

  it("does nothing when the org has no active provider", async () => {
    const emptyOrg = await createOrg("No Provider Org");
    const emptyCtx: Ctx = { ...ctx, orgId: emptyOrg };
    const id = await enqueue(emptyCtx, message);
    await processOutbox(emptyCtx, 10);

    const stored = await withTenant(emptyOrg, async (c) =>
      (await c.query<{ last_error: string }>(
        "SELECT last_error FROM email_messages WHERE id = $1", [id],
      )).rows[0],
    );
    expect(stored.last_error).toMatch(/no active email provider/i);
  });
});

describe("listMessages", () => {
  it("returns recent messages with the provider that sent them", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 202, headers: { "x-message-id": "sg-2" } }),
    );
    await enqueue(ctx, message);
    await processOutbox(ctx, 10);

    const listed = (await listMessages(ctx, 10)) as {
      subject: string; status: string; provider_name: string | null;
    }[];
    expect(listed[0]).toMatchObject({ status: "sent", provider_name: "Primary" });
  });

  it("never returns the message bodies, which may quote asset data", async () => {
    await enqueue(ctx, message);
    const listed = (await listMessages(ctx, 10)) as Record<string, unknown>[];
    expect(listed[0]).not.toHaveProperty("html_body");
    expect(listed[0]).not.toHaveProperty("text_body");
  });
});
