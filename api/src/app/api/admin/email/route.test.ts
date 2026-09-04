import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { createOrg, createUserWithRole } from "@/test/org";
import { createSession } from "@/lib/auth/session";
import { GET as LIST, POST as CREATE } from "./providers/route";
import { PATCH, DELETE } from "./providers/[id]/route";
import { POST as TEST_SEND } from "./providers/[id]/test/route";
import { GET as TEMPLATES, PUT as SAVE_TEMPLATE } from "./templates/route";
import { GET as MESSAGES } from "./messages/route";

let orgId: string;
let adminSession: string;
let managerSession: string;

const url = "http://api.test/api/admin/email/providers";

const req = (session: string, method = "GET", body?: unknown, target = url) =>
  new Request(target, {
    method,
    headers: { cookie: `ams_session=${session}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const withId = (session: string, id: string, method: string, body?: unknown, suffix = "") => ({
  request: req(session, method, body, `${url}/${id}${suffix}`),
  ctx: { params: Promise.resolve({ id }) },
});

const sendgrid = (name: string) => ({
  name, type: "sendgrid", from_email: "ams@example.com", from_name: "AMS",
  priority: 10, active: true, config: { api_key: "SG.secret-value" },
});

beforeAll(async () => {
  orgId = await createOrg("Email Routes Org");
  adminSession = await createSession(
    (await createUserWithRole(orgId, "Administrator")).id, orgId);
  managerSession = await createSession(
    (await createUserWithRole(orgId, "Manager")).id, orgId);
});

beforeEach(() => vi.restoreAllMocks());

describe("authorization", () => {
  it("refuses an unauthenticated caller", async () => {
    expect((await LIST(new Request(url))).status).toBe(401);
  });

  it("refuses a manager, who does not hold settings:write", async () => {
    // Email credentials are an organisation setting, not day-to-day register work.
    expect((await LIST(req(managerSession))).status).toBe(403);
    expect((await CREATE(req(managerSession, "POST", sendgrid("Nope")))).status).toBe(403);
  });
});

describe("provider CRUD", () => {
  it("creates a provider and masks the secret in the response", async () => {
    const res = await CREATE(req(adminSession, "POST", sendgrid("Primary")));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { config: { api_key: string } };
    expect(body.config.api_key).toMatch(/•/);
    expect(body.config.api_key).not.toContain("secret-value");
  });

  it("never exposes the secret on the listing either", async () => {
    const raw = await (await LIST(req(adminSession))).text();
    expect(raw).not.toContain("secret-value");
  });

  it("rejects an invalid config with 422", async () => {
    const res = await CREATE(req(adminSession, "POST", {
      ...sendgrid("Broken"), config: {},
    }));
    expect(res.status).toBe(422);
  });

  it("reports a duplicate name as 409", async () => {
    await CREATE(req(adminSession, "POST", sendgrid("Dupe")));
    expect((await CREATE(req(adminSession, "POST", sendgrid("Dupe")))).status).toBe(409);
  });

  it("updates and deletes", async () => {
    const created = (await (await CREATE(
      req(adminSession, "POST", sendgrid("Editable")),
    )).json()) as { id: string };

    const patch = withId(adminSession, created.id, "PATCH", { priority: 5 });
    const patched = await PATCH(patch.request, patch.ctx);
    expect(patched.status).toBe(200);
    expect((await patched.json()) as { priority: number }).toMatchObject({ priority: 5 });

    const removed = withId(adminSession, created.id, "DELETE");
    expect((await DELETE(removed.request, removed.ctx)).status).toBe(204);
  });

  it("reports an unknown provider as not found", async () => {
    const missing = withId(
      adminSession, "00000000-0000-0000-0000-000000000000", "PATCH", { priority: 1 },
    );
    expect((await PATCH(missing.request, missing.ctx)).status).toBe(404);
  });
});

describe("test send", () => {
  it("answers 200 with ok:false when the credentials are wrong", async () => {
    // "Your key is bad" is a successful answer to "is my key good?" - an error
    // status would make the UI show a request failure instead of the verdict.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("bad", { status: 401 }));
    const created = (await (await CREATE(
      req(adminSession, "POST", sendgrid("Testable")),
    )).json()) as { id: string };

    const call = withId(
      adminSession, created.id, "POST", { to: "ops@example.com" }, "/test",
    );
    const res = await TEST_SEND(call.request, call.ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("401");
  });

  it("answers ok:true when the provider accepts", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 202, headers: { "x-message-id": "sg-t" } }),
    );
    const created = (await (await CREATE(
      req(adminSession, "POST", sendgrid("Working")),
    )).json()) as { id: string };

    const call = withId(
      adminSession, created.id, "POST", { to: "ops@example.com" }, "/test",
    );
    expect((await (await TEST_SEND(call.request, call.ctx)).json()) as { ok: boolean })
      .toMatchObject({ ok: true });
  });

  it("rejects a malformed recipient", async () => {
    const call = withId(
      adminSession, "00000000-0000-0000-0000-000000000000", "POST",
      { to: "not-an-email" }, "/test",
    );
    expect((await TEST_SEND(call.request, call.ctx)).status).toBe(422);
  });
});

describe("templates", () => {
  const templatesUrl = "http://api.test/api/admin/email/templates";

  it("lists the seeded defaults", async () => {
    const res = await TEMPLATES(req(adminSession, "GET", undefined, templatesUrl));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { key: string }[] };
    expect(body.data.map((t) => t.key)).toContain("asset.overdue");
  });

  it("saves an organisation override", async () => {
    const res = await SAVE_TEMPLATE(req(adminSession, "PUT", {
      key: "asset.overdue",
      subject: "Custom: {{asset.name}} is late",
      html_body: "<p>Please return it.</p>",
      text_body: "Please return it.",
    }, templatesUrl));
    expect(res.status).toBe(200);
    expect((await res.json()) as { subject: string }).toMatchObject({
      subject: "Custom: {{asset.name}} is late",
    });
  });

  it("rejects an empty body", async () => {
    const res = await SAVE_TEMPLATE(req(adminSession, "PUT", {
      key: "asset.overdue", subject: "", html_body: "", text_body: "",
    }, templatesUrl));
    expect(res.status).toBe(422);
  });
});

describe("message log", () => {
  it("returns metadata without the message bodies", async () => {
    const res = await MESSAGES(
      req(adminSession, "GET", undefined, "http://api.test/api/admin/email/messages"),
    );
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain("html_body");
  });
});
