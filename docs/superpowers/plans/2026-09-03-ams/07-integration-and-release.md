# Phase 7 — Integration & release

> Part of the [Assets Management System plan](./00-overview.md). Read `00-overview.md` first — its Global Constraints apply to every task here.

**Tasks 45–49.** Idempotency, webhooks, the OpenAPI document, and the versioning and release pipeline.

**Spec sections:** §5 (public API conventions), §11 (versioning and release management).

| Task | Deliverable |
|---|---|
| 33 | Idempotency keys and outbound webhooks with HMAC signatures |
| 34 | The OpenAPI 3.1 document, generated from the code |
| 35 | `/api/version`, release notes API, "what's new" backend |
| 36 | CI pipeline, changelog generation and the release runbook |

---

### Task 45: Idempotency and webhooks

**Files:**
- Create: `api/src/lib/http/idempotency.ts`, `api/src/lib/domain/webhooks.ts`
- Create: `api/src/app/api/v1/webhooks/route.ts`, `api/src/app/api/v1/webhooks/[id]/route.ts`
- Modify: `api/src/app/api/v1/assets/route.ts` and `…/[id]/checkout/route.ts` (wrap POST in idempotency)
- Modify: `api/src/lib/notify/dispatch.ts` (dispatch the `webhook` channel)
- Modify: `api/src/lib/jobs/runner.ts` (drain webhook deliveries)
- Test: `api/src/lib/http/idempotency.test.ts`, `api/src/lib/domain/webhooks.test.ts`

**Interfaces:**
- Consumes: `withTenant`, `Ctx`, `rulesFor` (Task 14), the `webhooks` and `idempotency_keys` tables.
- Produces:
  - `withIdempotency(req, ctx, handler): Promise<Response>` — replays the stored response for a repeated key within 24 h
  - `WEBHOOK_EVENTS`, `WebhookInput`, `listWebhooks`, `createWebhook`, `deleteWebhook`
  - `signPayload(secret, body): string` — `sha256=<hex hmac>`
  - `queueDelivery(ctx, event, payload)`, `deliverPending(ctx)` — 3 retries with exponential backoff

**Design note (spec §5.1):** integrators retry. Without idempotency, a network timeout on
`POST /assets` produces two assets and nobody can tell which is real. The key is stored
with its response, so the retry gets the original answer rather than a duplicate.

- [ ] **Step 1: Write the failing tests**

`api/src/lib/http/idempotency.test.ts`:

```ts
import { describe, it, expect, beforeAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import type { Ctx } from "./handler";
import { withIdempotency } from "./idempotency";

const orgId = randomUUID();
const ctx: Ctx = {
  orgId, actor: { type: "api_key", id: randomUUID(), label: "CI", scopes: ["admin"] },
};

beforeAll(async () => {
  await pool.query("INSERT INTO organizations (id,name,slug) VALUES ($1,'Idem',$2)", [
    orgId, `idem-org-${orgId.slice(0, 8)}`,
  ]);
});

const request = (key?: string) =>
  new Request("http://x/api/v1/assets", {
    method: "POST",
    headers: key ? { "idempotency-key": key } : {},
  });

describe("withIdempotency", () => {
  it("runs the handler when no key is supplied", async () => {
    const handler = vi.fn().mockResolvedValue(Response.json({ id: "a1" }, { status: 201 }));
    const res = await withIdempotency(request(), ctx, handler);
    expect(handler).toHaveBeenCalledOnce();
    expect(res.status).toBe(201);
  });

  it("runs the handler the first time a key is seen", async () => {
    const handler = vi.fn().mockResolvedValue(Response.json({ id: "a2" }, { status: 201 }));
    const res = await withIdempotency(request("key-1"), ctx, handler);
    expect(handler).toHaveBeenCalledOnce();
    await expect(res.json()).resolves.toEqual({ id: "a2" });
  });

  it("replays the stored response for a repeated key", async () => {
    const handler = vi.fn().mockResolvedValue(Response.json({ id: "a3" }, { status: 201 }));
    await withIdempotency(request("key-2"), ctx, handler);

    const second = vi.fn().mockResolvedValue(Response.json({ id: "different" }));
    const res = await withIdempotency(request("key-2"), ctx, second);

    expect(second).not.toHaveBeenCalled();
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({ id: "a3" });
    expect(res.headers.get("Idempotent-Replay")).toBe("true");
  });

  it("scopes keys per organisation", async () => {
    const otherOrg = randomUUID();
    await pool.query("INSERT INTO organizations (id,name,slug) VALUES ($1,'Other',$2)", [
      otherOrg, `other-idem-${otherOrg.slice(0, 8)}`,
    ]);
    const handler = vi.fn().mockResolvedValue(Response.json({ id: "b1" }, { status: 201 }));
    await withIdempotency(request("shared-key"), ctx, handler);
    await withIdempotency(request("shared-key"), { ...ctx, orgId: otherOrg }, handler);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("does not store a failed response, so a retry can still succeed", async () => {
    const failing = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ title: "Boom" }), { status: 500 }),
    );
    await withIdempotency(request("key-3"), ctx, failing);

    const succeeding = vi.fn().mockResolvedValue(Response.json({ id: "ok" }, { status: 201 }));
    const res = await withIdempotency(request("key-3"), ctx, succeeding);
    expect(succeeding).toHaveBeenCalledOnce();
    expect(res.status).toBe(201);
  });
});
```

`api/src/lib/domain/webhooks.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { randomUUID, createHmac } from "node:crypto";
import { pool } from "../db";
import type { Ctx } from "../http/handler";
import {
  createWebhook, listWebhooks, signPayload, queueDelivery, deliverPending,
} from "./webhooks";

const orgId = randomUUID();
const ctx: Ctx = {
  orgId, actor: { type: "user", id: randomUUID(), label: "Admin", scopes: ["admin"] },
};

beforeAll(async () => {
  await pool.query("INSERT INTO organizations (id,name,slug) VALUES ($1,'Hook',$2)", [
    orgId, `hook-org-${orgId.slice(0, 8)}`,
  ]);
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await pool.query("DELETE FROM webhook_deliveries WHERE org_id=$1", [orgId]);
  await pool.query("DELETE FROM webhooks WHERE org_id=$1", [orgId]);
});

describe("signPayload", () => {
  it("produces a verifiable sha256 HMAC", () => {
    const body = JSON.stringify({ event: "asset.checked_out" });
    const expected = createHmac("sha256", "secret").update(body).digest("hex");
    expect(signPayload("secret", body)).toBe(`sha256=${expected}`);
  });

  it("changes when the body changes", () => {
    expect(signPayload("s", "a")).not.toBe(signPayload("s", "b"));
  });
});

describe("createWebhook", () => {
  it("generates a secret and returns it once", async () => {
    const hook = await createWebhook(ctx, {
      url: "https://client.example.com/hooks/ams",
      events: ["asset.checked_out"],
      active: true,
    });
    expect(hook.secret).toMatch(/^whsec_[A-Za-z0-9_-]{20,}$/);
  });

  it("masks the secret on subsequent reads", async () => {
    await createWebhook(ctx, {
      url: "https://client.example.com/x", events: ["asset.created"], active: true,
    });
    const [hook] = await listWebhooks(ctx);
    expect(hook.secret).toMatch(/•/);
  });

  it("rejects a non-https url", async () => {
    await expect(createWebhook(ctx, {
      url: "http://insecure.example.com", events: ["asset.created"], active: true,
    })).rejects.toThrow(/https/i);
  });
});

describe("deliverPending", () => {
  it("posts the payload with a signature header", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    const hook = await createWebhook(ctx, {
      url: "https://client.example.com/hooks", events: ["asset.checked_out"], active: true,
    });
    await queueDelivery(ctx, "asset.checked_out", { asset_id: "a1" });
    await deliverPending(ctx);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://client.example.com/hooks");
    const headers = init!.headers as Record<string, string>;
    expect(headers["X-AMS-Event"]).toBe("asset.checked_out");
    expect(headers["X-AMS-Signature"])
      .toBe(signPayload(hook.secret, init!.body as string));
  });

  it("only delivers to hooks subscribed to that event", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    await createWebhook(ctx, {
      url: "https://a.example.com", events: ["asset.created"], active: true,
    });
    await queueDelivery(ctx, "asset.checked_out", { asset_id: "a1" });
    await deliverPending(ctx);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips an inactive hook", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    await createWebhook(ctx, {
      url: "https://a.example.com", events: ["asset.created"], active: false,
    });
    await queueDelivery(ctx, "asset.created", {});
    await deliverPending(ctx);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries with a backoff when the endpoint errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));
    await createWebhook(ctx, {
      url: "https://a.example.com", events: ["asset.created"], active: true,
    });
    await queueDelivery(ctx, "asset.created", {});
    await deliverPending(ctx);

    const { rows } = await pool.query(
      `SELECT status, attempts, next_attempt_at > now() AS deferred
         FROM webhook_deliveries WHERE org_id=$1`, [orgId],
    );
    expect(rows[0]).toMatchObject({ status: "pending", attempts: 1, deferred: true });
  });

  it("gives up after three attempts", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));
    await createWebhook(ctx, {
      url: "https://a.example.com", events: ["asset.created"], active: true,
    });
    await queueDelivery(ctx, "asset.created", {});
    await pool.query("UPDATE webhook_deliveries SET attempts = 2 WHERE org_id=$1", [orgId]);
    await deliverPending(ctx);

    const { rows } = await pool.query(
      "SELECT status FROM webhook_deliveries WHERE org_id=$1", [orgId],
    );
    expect(rows[0].status).toBe("failed");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd api && npx vitest run src/lib/http/idempotency.test.ts src/lib/domain/webhooks.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the migration**

`api/migrations/009_webhook_deliveries.sql`:

```sql
ALTER TABLE webhooks
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS last_delivered_at timestamptz;

CREATE TABLE webhook_deliveries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  webhook_id      uuid NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event           text NOT NULL,
  payload         jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'pending',
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text,
  response_status integer,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  delivered_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webhook_deliveries_status_chk
    CHECK (status IN ('pending', 'delivered', 'failed'))
);
CREATE INDEX webhook_deliveries_due_idx
  ON webhook_deliveries (status, next_attempt_at) WHERE status = 'pending';

ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON webhook_deliveries
  USING (org_id = current_setting('app.org_id')::uuid)
  WITH CHECK (org_id = current_setting('app.org_id')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON webhook_deliveries TO ams_app;
```

- [ ] **Step 4: Implement idempotency**

`api/src/lib/http/idempotency.ts`:

```ts
import { withTenant } from "../db";
import type { Ctx } from "./handler";

/**
 * Replays the stored response when the same Idempotency-Key is seen again.
 * Integrators retry on timeout; without this, one retried POST becomes two assets
 * and nobody can tell which is real.
 */
export async function withIdempotency(
  req: Request,
  ctx: Ctx,
  handler: () => Promise<Response>,
): Promise<Response> {
  const key = req.headers.get("idempotency-key");
  if (!key) return handler();

  const stored = await withTenant(ctx.orgId, async (c) =>
    (await c.query<{ response: unknown; status: number }>(
      `SELECT response, status FROM idempotency_keys
        WHERE key = $1 AND created_at > now() - interval '24 hours'`,
      [key],
    )).rows[0],
  );

  if (stored) {
    return new Response(JSON.stringify(stored.response), {
      status: stored.status,
      headers: {
        "content-type": "application/json",
        "Idempotent-Replay": "true",
      },
    });
  }

  const response = await handler();

  // Only successful responses are recorded. A 500 should be retryable, not
  // permanently cached as the answer.
  if (response.status >= 200 && response.status < 300) {
    const body = await response.clone().json().catch(() => null);
    if (body !== null) {
      await withTenant(ctx.orgId, (c) =>
        c.query(
          `INSERT INTO idempotency_keys (org_id, key, response, status)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (org_id, key) DO NOTHING`,
          [ctx.orgId, key, JSON.stringify(body), response.status],
        ),
      );
    }
  }

  return response;
}
```

Wrap the create and check-out handlers. In `api/src/app/api/v1/assets/route.ts`, change
the `POST` body to:

```ts
export const POST = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "assets:write");
  if (isResponse(ctx)) return ctx;

  return withIdempotency(req, ctx, async () => {
    const parsed = AssetInput.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return validationProblem(parsed.error);
    try {
      return Response.json(await createAsset(ctx, parsed.data), { status: 201 });
    } catch (err) {
      const e = err as { code?: string; message: string };
      if (e.code === "23505") {
        return problem(409, "conflict", "Duplicate value", {
          detail: "An asset with that tag or serial number already exists.",
        });
      }
      if (e.message.startsWith("custom field")) {
        return problem(422, "validation", "Validation failed", { detail: e.message });
      }
      throw err;
    }
  });
});
```

Apply the same wrapper to `…/assets/[id]/checkout/route.ts`.

- [ ] **Step 5: Implement webhooks**

`api/src/lib/domain/webhooks.ts`:

```ts
import { z } from "zod";
import { createHmac, randomBytes } from "node:crypto";
import { withTenant } from "../db";
import type { Ctx } from "../http/handler";

export const WEBHOOK_EVENTS = [
  "asset.created", "asset.updated", "asset.deleted",
  "asset.checked_out", "asset.checked_in",
  "asset.overdue", "import.completed",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const WebhookInput = z.object({
  url: z.string().url().refine((u) => u.startsWith("https://"), {
    message: "Webhook URLs must use https — payloads carry asset data.",
  }),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
  active: z.boolean().default(true),
});
export type WebhookInput = z.infer<typeof WebhookInput>;

export interface Webhook {
  id: string;
  url: string;
  secret: string;
  events: string[];
  active: boolean;
  last_error: string | null;
  last_delivered_at: string | null;
}

const MAX_ATTEMPTS = 3;
/** 1 min, 10 min, 60 min — a client's brief outage should not lose the event. */
const BACKOFF_MINUTES = [1, 10, 60];

export const signPayload = (secret: string, body: string): string =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

export function createWebhook(ctx: Ctx, raw: WebhookInput): Promise<Webhook> {
  const input = WebhookInput.parse(raw);
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;

  return withTenant(ctx.orgId, async (c) =>
    (await c.query<Webhook>(
      `INSERT INTO webhooks (org_id, url, secret, events, active)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id, url, secret, events, active, last_error, last_delivered_at`,
      [ctx.orgId, input.url, secret, input.events, input.active],
    )).rows[0],
  );
}

/** Reads mask the secret — it is shown in full only at creation. */
export const listWebhooks = (ctx: Ctx) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query<Webhook>(
      `SELECT id, url, secret, events, active, last_error, last_delivered_at
         FROM webhooks ORDER BY created_at`,
    )).rows.map((hook) => ({
      ...hook,
      secret: `whsec_••••${hook.secret.slice(-4)}`,
    })),
  );

export const deleteWebhook = (ctx: Ctx, id: string) =>
  withTenant(ctx.orgId, async (c) =>
    (await c.query("DELETE FROM webhooks WHERE id = $1 RETURNING id", [id]))
      .rowCount === 1,
  );

/** Fans an event out to every subscribed hook as a pending delivery row. */
export async function queueDelivery(
  ctx: Ctx,
  event: string,
  payload: Record<string, unknown>,
): Promise<number> {
  return withTenant(ctx.orgId, async (c) => {
    const { rowCount } = await c.query(
      `INSERT INTO webhook_deliveries (org_id, webhook_id, event, payload)
       SELECT $1, id, $2, $3
         FROM webhooks
        WHERE active = true AND $2 = ANY(events)`,
      [ctx.orgId, event, JSON.stringify(payload)],
    );
    return rowCount ?? 0;
  });
}

interface PendingDelivery {
  id: string;
  webhook_id: string;
  url: string;
  secret: string;
  event: string;
  payload: Record<string, unknown>;
  attempts: number;
}

export async function deliverPending(
  ctx: Ctx,
  limit = 50,
): Promise<{ delivered: number; failed: number }> {
  const pending = await withTenant(ctx.orgId, async (c) =>
    (await c.query<PendingDelivery>(
      `SELECT d.id, d.webhook_id, w.url, w.secret, d.event, d.payload, d.attempts
         FROM webhook_deliveries d
         JOIN webhooks w ON w.id = d.webhook_id
        WHERE d.status = 'pending' AND d.next_attempt_at <= now()
        ORDER BY d.next_attempt_at
        LIMIT $1
        FOR UPDATE OF d SKIP LOCKED`,
      [limit],
    )).rows,
  );

  let delivered = 0;
  let failed = 0;

  for (const item of pending) {
    const body = JSON.stringify({
      event: item.event,
      delivery_id: item.id,
      occurred_at: new Date().toISOString(),
      data: item.payload,
    });

    let ok = false;
    let status: number | null = null;
    let error: string | null = null;

    try {
      const response = await fetch(item.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-AMS-Event": item.event,
          "X-AMS-Delivery": item.id,
          "X-AMS-Signature": signPayload(item.secret, body),
          "user-agent": "AMS-Webhooks/1.0",
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      status = response.status;
      ok = response.ok;
      if (!ok) error = `Endpoint returned ${response.status}`;
    } catch (err) {
      error = (err as Error).message;
    }

    const attempts = item.attempts + 1;
    if (ok) {
      await withTenant(ctx.orgId, async (c) => {
        await c.query(
          `UPDATE webhook_deliveries SET
             status = 'delivered', attempts = $2, response_status = $3,
             delivered_at = now(), last_error = NULL
           WHERE id = $1`,
          [item.id, attempts, status],
        );
        await c.query(
          "UPDATE webhooks SET last_delivered_at = now(), last_error = NULL WHERE id = $1",
          [item.webhook_id],
        );
      });
      delivered++;
    } else {
      const exhausted = attempts >= MAX_ATTEMPTS;
      const wait = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)];
      await withTenant(ctx.orgId, async (c) => {
        await c.query(
          `UPDATE webhook_deliveries SET
             status = $2, attempts = $3, response_status = $4, last_error = $5,
             next_attempt_at = now() + ($6 || ' minutes')::interval
           WHERE id = $1`,
          [item.id, exhausted ? "failed" : "pending", attempts, status, error, String(wait)],
        );
        await c.query("UPDATE webhooks SET last_error = $2 WHERE id = $1",
          [item.webhook_id, error]);
      });
      failed++;
    }
  }

  return { delivered, failed };
}
```

- [ ] **Step 6: Wire webhooks into dispatch and the job runner**

In `api/src/lib/notify/dispatch.ts`, add the webhook channel after the email loop, inside
the same `try`:

```ts
import { queueDelivery } from "../domain/webhooks";

// …after queueing emails:
    // The webhook channel takes no template and no recipients — the event itself
    // is the payload, and subscription is the routing.
    await queueDelivery(ctx, event, context as Record<string, unknown>);
```

In `api/src/lib/jobs/runner.ts`, drain deliveries alongside the outbox:

```ts
import { deliverPending } from "../domain/webhooks";

// inside runAllJobs, after processOutbox:
      const hooks = await deliverPending(ctx, 100);
      console.log(JSON.stringify({
        org: org.name, overdue: overdue.notified, ...expiry, ...mail,
        webhooks_delivered: hooks.delivered, webhooks_failed: hooks.failed,
      }));

// inside runOutboxOnly, after processOutbox:
      await deliverPending(systemCtx(org.id), 50);
```

- [ ] **Step 7: Implement the webhook route handlers**

`api/src/app/api/v1/webhooks/route.ts`:

```ts
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { validationProblem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import {
  listWebhooks, createWebhook, WebhookInput, WEBHOOK_EVENTS,
} from "@/lib/domain/webhooks";

export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "admin");
  if (isResponse(ctx)) return ctx;
  return Response.json({ data: await listWebhooks(ctx), events: WEBHOOK_EVENTS });
});

export const POST = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "admin");
  if (isResponse(ctx)) return ctx;
  const parsed = WebhookInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  const hook = await createWebhook(ctx, parsed.data);
  // The secret is returned in full exactly once — it cannot be read back later.
  return Response.json(hook, { status: 201 });
});
```

`api/src/app/api/v1/webhooks/[id]/route.ts`:

```ts
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { notFound } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { deleteWebhook } from "@/lib/domain/webhooks";

export const DELETE = safe(async (
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const ctx = await requireAuth(req, "admin");
  if (isResponse(ctx)) return ctx;
  const done = await deleteWebhook(ctx, (await params).id);
  return done ? new Response(null, { status: 204 }) : notFound("webhook");
});
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
cd api
MIGRATION_DATABASE_URL=postgres://ams:ams@localhost:5433/ams_test npm run migrate
npx vitest run src/lib/http/idempotency.test.ts src/lib/domain/webhooks.test.ts
```

Expected: PASS, 13 tests.

- [ ] **Step 9: Commit**

```bash
git add api/migrations/009_webhook_deliveries.sql api/src/lib/http/idempotency.ts api/src/lib/domain/webhooks.ts api/src/lib/notify/dispatch.ts api/src/lib/jobs/runner.ts api/src/app/api/v1
git commit -m "feat: idempotency keys and signed webhooks with retry and backoff"
```

---

### Task 46: The OpenAPI document

**Files:**
- Create: `api/src/lib/openapi/document.ts`, `api/src/lib/openapi/schemas.ts`
- Create: `api/src/app/api/v1/openapi.json/route.ts`
- Test: `api/src/lib/openapi/document.test.ts`

**Interfaces:**
- Consumes: the Zod input schemas already defined (`AssetInput`, `CheckOutInput`, `CategoryInput`, …).
- Produces:
  - `buildOpenApiDocument(): OpenAPIObject` — OpenAPI 3.1
  - `GET /api/v1/openapi.json` — unauthenticated, cached

**Design note:** schemas are generated from the same Zod objects the handlers validate
with, via `zod-to-json-schema`. Hand-written API docs drift within a month; generated
ones cannot.

- [ ] **Step 1: Write the failing test**

`api/src/lib/openapi/document.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildOpenApiDocument } from "./document";

const doc = buildOpenApiDocument();

describe("buildOpenApiDocument", () => {
  it("declares OpenAPI 3.1 with a titled, versioned info block", () => {
    expect(doc.openapi).toMatch(/^3\.1/);
    expect(doc.info.title).toBeTruthy();
    expect(doc.info.version).toBeTruthy();
  });

  it("documents every public endpoint from the spec", () => {
    const paths = Object.keys(doc.paths ?? {});
    for (const path of [
      "/assets", "/assets/{id}", "/assets/{id}/checkout", "/assets/{id}/checkin",
      "/assets/{id}/history", "/assets/lookup", "/categories", "/locations",
      "/users", "/imports", "/dashboard/summary", "/reports/{key}", "/webhooks",
    ]) {
      expect(paths, `missing ${path}`).toContain(path);
    }
  });

  it("declares bearer API-key security globally", () => {
    expect(doc.components?.securitySchemes?.ApiKey).toMatchObject({
      type: "http", scheme: "bearer",
    });
    expect(doc.security).toContainEqual({ ApiKey: [] });
  });

  it("generates the Asset request schema from the Zod input", () => {
    const schema = doc.components?.schemas?.AssetInput as { properties?: object };
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining(["name", "serial_no", "status", "custom"]),
    );
  });

  it("documents the paginated envelope", () => {
    const list = doc.paths?.["/assets"]?.get?.responses?.["200"];
    expect(JSON.stringify(list)).toContain("meta");
  });

  it("documents the problem+json error shape on every operation", () => {
    for (const [path, item] of Object.entries(doc.paths ?? {})) {
      for (const [method, operation] of Object.entries(item as object)) {
        if (!["get", "post", "patch", "delete"].includes(method)) continue;
        const responses = (operation as { responses: object }).responses;
        expect(Object.keys(responses), `${method} ${path}`).toContain("422");
      }
    }
  });

  it("documents pagination and sort parameters on list endpoints", () => {
    const params = JSON.stringify(doc.paths?.["/assets"]?.get?.parameters);
    expect(params).toContain("page");
    expect(params).toContain("per_page");
    expect(params).toContain("sort");
  });

  it("declares the rate-limit response", () => {
    expect(JSON.stringify(doc)).toContain("429");
  });

  it("groups operations under tags", () => {
    expect(doc.tags?.map((t) => t.name)).toEqual(
      expect.arrayContaining(["Assets", "Catalogue", "Reports", "Webhooks"]),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd api && npx vitest run src/lib/openapi`
Expected: FAIL — module not found.

- [ ] **Step 3: Add the dependency**

```bash
cd api && npm install zod-to-json-schema && npm install -D openapi-types
```

- [ ] **Step 4: Implement the schema generation**

`api/src/lib/openapi/schemas.ts`:

```ts
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZodTypeAny } from "zod";
import { AssetInput } from "../domain/assets";
import { CategoryInput } from "../domain/categories";
import { LocationInput } from "../domain/locations";
import { CheckInInput, CheckOutInput } from "../domain/assignments";
import { WebhookInput } from "../domain/webhooks";

const toSchema = (schema: ZodTypeAny, name: string) =>
  zodToJsonSchema(schema, { name, target: "openApi3", $refStrategy: "none" })
    .definitions![name];

/** Generated from the same Zod objects the handlers validate with, so they cannot drift. */
export const componentSchemas: Record<string, unknown> = {
  AssetInput: toSchema(AssetInput, "AssetInput"),
  CategoryInput: toSchema(CategoryInput, "CategoryInput"),
  LocationInput: toSchema(LocationInput, "LocationInput"),
  CheckOutInput: toSchema(CheckOutInput, "CheckOutInput"),
  CheckInInput: toSchema(CheckInInput, "CheckInInput"),
  WebhookInput: toSchema(WebhookInput, "WebhookInput"),

  Asset: {
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      asset_tag: { type: "string", example: "AMS-000123" },
      name: { type: "string" },
      description: { type: ["string", "null"] },
      category_id: { type: ["string", "null"], format: "uuid" },
      category_name: { type: ["string", "null"] },
      serial_no: { type: ["string", "null"] },
      status: {
        type: "string",
        enum: ["available", "in_use", "maintenance", "retired", "lost"],
      },
      location_id: { type: ["string", "null"], format: "uuid" },
      location_name: { type: ["string", "null"] },
      assignee_id: { type: ["string", "null"], format: "uuid" },
      assignee_name: { type: ["string", "null"] },
      purchase_date: { type: ["string", "null"], format: "date" },
      purchase_cost: { type: ["string", "null"], example: "15000000.00" },
      currency: { type: "string", example: "IDR" },
      custom: {
        type: "object",
        additionalProperties: true,
        description: "Values for the fields defined by the asset's category.",
      },
      created_at: { type: "string", format: "date-time" },
      updated_at: { type: "string", format: "date-time" },
    },
  },

  Problem: {
    type: "object",
    description: "RFC 7807 problem document.",
    properties: {
      type: { type: "string", format: "uri" },
      title: { type: "string" },
      status: { type: "integer" },
      detail: { type: "string" },
      errors: {
        type: "array",
        items: {
          type: "object",
          properties: {
            field: { type: "string" },
            message: { type: "string" },
          },
        },
      },
    },
  },

  PageMeta: {
    type: "object",
    properties: {
      page: { type: "integer" },
      per_page: { type: "integer" },
      total: { type: "integer" },
      total_pages: { type: "integer" },
    },
  },
};
```

- [ ] **Step 5: Implement the document builder**

`api/src/lib/openapi/document.ts`:

```ts
import { componentSchemas } from "./schemas";

const json = (schema: unknown) => ({ "application/json": { schema } });

const problemResponse = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: ref("Problem") } },
});

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

/** Every operation can hit these, so they are attached everywhere. */
const commonResponses = {
  "401": problemResponse("Authentication required."),
  "403": problemResponse("The credential lacks the required scope."),
  "422": problemResponse("The request failed validation."),
  "429": problemResponse("Rate limit exceeded — see Retry-After."),
};

const paginationParams = [
  { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
  {
    name: "per_page", in: "query",
    schema: { type: "integer", minimum: 1, maximum: 200, default: 50 },
  },
  {
    name: "sort", in: "query",
    description: "Column name; prefix with `-` for descending.",
    schema: { type: "string", example: "-created_at" },
  },
];

const idParam = {
  name: "id", in: "path", required: true,
  schema: { type: "string", format: "uuid" },
};

const paginated = (itemRef: string) => ({
  description: "A page of results.",
  content: json({
    type: "object",
    properties: {
      data: { type: "array", items: ref(itemRef) },
      meta: ref("PageMeta"),
    },
  }),
});

export function buildOpenApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Assets Management System API",
      version: process.env.APP_VERSION ?? "1.0.0",
      description:
        "Register, track and report on IT assets, plant equipment and digital media.\n\n" +
        "**Authentication.** Send an API key as `Authorization: Bearer ams_live_…`. " +
        "Mint keys in the dashboard under Settings → API keys.\n\n" +
        "**Errors** are RFC 7807 problem documents.\n\n" +
        "**Rate limit.** 1000 requests per hour per key. Exceeding it returns `429` " +
        "with `Retry-After`.\n\n" +
        "**Idempotency.** Send `Idempotency-Key` on any POST; a repeat within 24 hours " +
        "returns the original response instead of creating a duplicate.",
      contact: { name: "API support" },
    },
    servers: [
      { url: `${process.env.API_PUBLIC_URL ?? "http://localhost:4000"}/api/v1` },
    ],
    tags: [
      { name: "Assets", description: "The register itself." },
      { name: "Custody", description: "Check-out, check-in and history." },
      { name: "Catalogue", description: "Categories, locations and people." },
      { name: "Data", description: "Import and export." },
      { name: "Reports", description: "Reports and the dashboard summary." },
      { name: "Labels", description: "QR codes, barcodes and label sheets." },
      { name: "Webhooks", description: "Event subscriptions." },
    ],
    security: [{ ApiKey: [] }],
    components: {
      securitySchemes: {
        ApiKey: {
          type: "http",
          scheme: "bearer",
          description: "An API key minted in the dashboard, e.g. `ams_live_…`.",
        },
      },
      schemas: componentSchemas,
    },
    paths: {
      "/assets": {
        get: {
          tags: ["Assets"],
          summary: "List assets",
          description: "Search, filter, sort and paginate the register.",
          parameters: [
            {
              name: "q", in: "query",
              description: "Matches name, serial number or asset tag.",
              schema: { type: "string" },
            },
            {
              name: "status", in: "query",
              description: "Repeat the parameter to filter on several statuses.",
              schema: {
                type: "array",
                items: {
                  type: "string",
                  enum: ["available", "in_use", "maintenance", "retired", "lost"],
                },
              },
            },
            { name: "category_id", in: "query", schema: { type: "string", format: "uuid" } },
            { name: "location_id", in: "query", schema: { type: "string", format: "uuid" } },
            { name: "assignee_id", in: "query", schema: { type: "string", format: "uuid" } },
            {
              name: "custom[key]", in: "query",
              description: "Filter on a category custom field, e.g. `custom[os]=macOS`.",
              schema: { type: "string" },
            },
            ...paginationParams,
          ],
          responses: { "200": paginated("Asset"), ...commonResponses },
        },
        post: {
          tags: ["Assets"],
          summary: "Create an asset",
          parameters: [{
            name: "Idempotency-Key", in: "header",
            schema: { type: "string" },
            description: "Repeat-safe creation. A repeat within 24 hours replays the response.",
          }],
          requestBody: { required: true, content: json(ref("AssetInput")) },
          responses: {
            "201": { description: "Created.", content: json(ref("Asset")) },
            "409": problemResponse("An asset with that tag or serial number exists."),
            ...commonResponses,
          },
        },
      },

      "/assets/{id}": {
        get: {
          tags: ["Assets"], summary: "Get one asset",
          parameters: [idParam],
          responses: {
            "200": { description: "The asset.", content: json(ref("Asset")) },
            "404": problemResponse("No such asset."),
            ...commonResponses,
          },
        },
        patch: {
          tags: ["Assets"], summary: "Update an asset",
          description:
            "Partial update. `custom` merges into the stored object rather than replacing it.",
          parameters: [idParam],
          requestBody: { required: true, content: json(ref("AssetInput")) },
          responses: {
            "200": { description: "The updated asset.", content: json(ref("Asset")) },
            "404": problemResponse("No such asset."),
            ...commonResponses,
          },
        },
        delete: {
          tags: ["Assets"], summary: "Delete an asset",
          description: "Soft delete — the row and its history are retained.",
          parameters: [idParam],
          responses: {
            "204": { description: "Deleted." },
            "404": problemResponse("No such asset."),
            ...commonResponses,
          },
        },
      },

      "/assets/lookup": {
        get: {
          tags: ["Assets"],
          summary: "Resolve a scanned tag",
          description:
            "Accepts a bare asset tag or a full deep link from a QR code. " +
            "Case-insensitive and whitespace-tolerant, because scanners are not tidy.",
          parameters: [{
            name: "tag", in: "query", required: true,
            schema: { type: "string", example: "AMS-000123" },
          }],
          responses: {
            "200": { description: "The asset.", content: json(ref("Asset")) },
            "404": problemResponse("No asset carries that tag."),
            ...commonResponses,
          },
        },
      },

      "/assets/{id}/checkout": {
        post: {
          tags: ["Custody"], summary: "Check an asset out",
          parameters: [idParam],
          requestBody: { required: true, content: json(ref("CheckOutInput")) },
          responses: {
            "201": { description: "The new assignment." },
            "409": problemResponse("The asset cannot be checked out in its current state."),
            ...commonResponses,
          },
        },
      },

      "/assets/{id}/checkin": {
        post: {
          tags: ["Custody"], summary: "Check an asset in",
          parameters: [idParam],
          requestBody: { required: true, content: json(ref("CheckInInput")) },
          responses: {
            "200": { description: "The closed assignment." },
            "409": problemResponse("The asset is not currently checked out."),
            ...commonResponses,
          },
        },
      },

      "/assets/{id}/history": {
        get: {
          tags: ["Custody"], summary: "Read an asset's full history",
          parameters: [idParam],
          responses: {
            "200": { description: "Audit events and assignments." },
            "404": problemResponse("No such asset."),
            ...commonResponses,
          },
        },
      },

      "/categories": {
        get: {
          tags: ["Catalogue"], summary: "List categories and their field schemas",
          responses: { "200": { description: "Categories." }, ...commonResponses },
        },
        post: {
          tags: ["Catalogue"], summary: "Create a category",
          requestBody: { required: true, content: json(ref("CategoryInput")) },
          responses: { "201": { description: "Created." }, ...commonResponses },
        },
      },

      "/locations": {
        get: {
          tags: ["Catalogue"], summary: "List the location tree",
          responses: { "200": { description: "Locations." }, ...commonResponses },
        },
        post: {
          tags: ["Catalogue"], summary: "Create a location",
          requestBody: { required: true, content: json(ref("LocationInput")) },
          responses: { "201": { description: "Created." }, ...commonResponses },
        },
      },

      "/users": {
        get: {
          tags: ["Catalogue"], summary: "List assignable people",
          responses: { "200": { description: "Users." }, ...commonResponses },
        },
      },

      "/imports": {
        post: {
          tags: ["Data"],
          summary: "Import assets from CSV or Excel",
          description:
            "Multipart upload. Omit `mapping` to receive the detected headers and a " +
            "suggested mapping. Send `dry_run=true` to preview without writing.",
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  properties: {
                    file: { type: "string", format: "binary" },
                    mapping: { type: "string", description: "JSON: header → field." },
                    category_id: { type: "string", format: "uuid" },
                    dry_run: { type: "string", enum: ["true", "false"] },
                  },
                  required: ["file"],
                },
              },
            },
          },
          responses: {
            "200": { description: "Inspection or dry-run result." },
            "201": { description: "The committed import result." },
            "413": problemResponse("The file exceeds 10 MB."),
            ...commonResponses,
          },
        },
      },

      "/dashboard/summary": {
        get: {
          tags: ["Reports"], summary: "Dashboard aggregates",
          responses: { "200": { description: "Summary." }, ...commonResponses },
        },
      },

      "/reports/{key}": {
        get: {
          tags: ["Reports"],
          summary: "Run a report",
          parameters: [
            {
              name: "key", in: "path", required: true,
              schema: {
                type: "string",
                enum: [
                  "assets-by-status", "assets-by-category", "assets-by-location",
                  "assignments-active", "assignments-overdue", "expiring",
                  "utilisation", "audit-activity", "acquisition-value",
                ],
              },
            },
            {
              name: "format", in: "query",
              schema: {
                type: "string",
                enum: ["json", "csv", "xlsx", "pdf", "svg", "png"],
                default: "json",
              },
            },
            { name: "from", in: "query", schema: { type: "string", format: "date" } },
            { name: "to", in: "query", schema: { type: "string", format: "date" } },
            { name: "days", in: "query", schema: { type: "integer" } },
            { name: "category_id", in: "query", schema: { type: "string", format: "uuid" } },
            { name: "location_id", in: "query", schema: { type: "string", format: "uuid" } },
          ],
          responses: {
            "200": {
              description: "The report in the requested format.",
              content: {
                "application/json": {},
                "text/csv": {},
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {},
                "application/pdf": {},
                "image/png": {},
                "image/svg+xml": {},
              },
            },
            "404": problemResponse("No such report."),
            ...commonResponses,
          },
        },
      },

      "/labels/sheet": {
        post: {
          tags: ["Labels"],
          summary: "Build a print-ready label sheet",
          requestBody: {
            required: true,
            content: json({
              type: "object",
              properties: {
                asset_ids: {
                  type: "array", items: { type: "string", format: "uuid" },
                  maxItems: 500,
                },
                symbology: { type: "string", enum: ["qr", "code128"] },
                template: {
                  type: "string",
                  enum: ["avery5160", "avery5163", "thermal50x25"],
                },
              },
              required: ["asset_ids"],
            }),
          },
          responses: {
            "200": { description: "Printable HTML.", content: { "text/html": {} } },
            ...commonResponses,
          },
        },
      },

      "/webhooks": {
        get: {
          tags: ["Webhooks"], summary: "List webhook subscriptions",
          responses: { "200": { description: "Webhooks." }, ...commonResponses },
        },
        post: {
          tags: ["Webhooks"],
          summary: "Subscribe to events",
          description:
            "The response contains the signing secret in full — it cannot be read back " +
            "later. Verify deliveries with `X-AMS-Signature: sha256=<hmac of the raw body>`.",
          requestBody: { required: true, content: json(ref("WebhookInput")) },
          responses: { "201": { description: "Created." }, ...commonResponses },
        },
      },
    },
  };
}
```

`api/src/app/api/v1/openapi.json/route.ts`:

```ts
import { buildOpenApiDocument } from "@/lib/openapi/document";
import { safe } from "@/lib/http/handler";

// Deliberately unauthenticated: an integrator must be able to read the contract
// before they have a key.
export const GET = safe(async () =>
  Response.json(buildOpenApiDocument(), {
    headers: {
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  }),
);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd api && npx vitest run src/lib/openapi`
Expected: PASS, 9 tests.

- [ ] **Step 7: Validate the document with an external linter**

```bash
cd api && npx @redocly/cli lint <(curl -s http://localhost:4000/api/v1/openapi.json)
```

Expected: no errors. Fix any the linter reports before committing — a document that does
not lint will break the client generators integrators use.

- [ ] **Step 8: Commit**

```bash
git add api/src/lib/openapi api/src/app/api/v1/openapi.json api/package.json
git commit -m "feat: openapi 3.1 document generated from the zod input schemas"
```

---

### Task 47: Version endpoint, build provenance and the release-notes API

**Files:**
- Create: `api/migrations/010_releases.sql`
- Create: `api/src/lib/domain/releases.ts`
- Create: `api/src/app/api/version/route.ts`, `api/src/app/api/releases/route.ts`, `api/src/app/api/admin/releases/seen/route.ts`, `api/src/app/api/admin/releases/unseen/route.ts`
- Modify: `api/Dockerfile` (build args), `api/src/app/api/health/route.ts` (deep check)
- Test: `api/src/lib/domain/releases.test.ts`

**Interfaces:**
- Consumes: `pool`, `withTenant`, `schema_migrations`.
- Produces:
  - `getVersionInfo(): Promise<VersionInfo>` — version, git sha, build time, migration head
  - `listReleases()`, `publishRelease(input)`, `markSeen(ctx, version)`, `countUnseen(ctx)`
  - `GET /api/version` (public), `GET /api/releases` (public), `POST /api/admin/releases/seen`, `GET /api/admin/releases/unseen`

**Design note (spec §11.4):** provenance is baked in at image build time via build args,
never read from a mutable file at runtime. A support conversation should start from a
known build rather than a guess.

- [ ] **Step 1: Write the failing test**

`api/src/lib/domain/releases.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import type { Ctx } from "../http/handler";
import {
  getVersionInfo, listReleases, publishRelease, markSeen, countUnseen,
} from "./releases";

const orgId = randomUUID();
const userId = randomUUID();
const ctx: Ctx = {
  orgId, actor: { type: "user", id: userId, label: "Rina", scopes: ["admin"] },
};

beforeAll(async () => {
  await pool.query("INSERT INTO organizations (id,name,slug) VALUES ($1,'Rel',$2)", [
    orgId, `rel-org-${orgId.slice(0, 8)}`,
  ]);
  await pool.query(
    `INSERT INTO users (id, org_id, email, password_hash, name, role)
     VALUES ($1,$2,$3,'x','Rina','admin')`,
    [userId, orgId, `rel-${orgId.slice(0, 8)}@example.com`],
  );
});

beforeEach(async () => {
  await pool.query("DELETE FROM user_release_seen WHERE user_id = $1", [userId]);
  await pool.query("DELETE FROM releases");
});

describe("getVersionInfo", () => {
  it("reports the build metadata and the applied migration head", async () => {
    process.env.APP_VERSION = "1.5.0";
    process.env.GIT_SHA = "3f9a1c2";
    const info = await getVersionInfo();
    expect(info).toMatchObject({ version: "1.5.0", git_sha: "3f9a1c2", api_version: "v1" });
    expect(info.migration_head).toMatch(/\.sql$/);
  });

  it("degrades to a placeholder rather than failing when nothing was baked in", async () => {
    delete process.env.APP_VERSION;
    delete process.env.GIT_SHA;
    const info = await getVersionInfo();
    expect(info.version).toBe("0.0.0-dev");
    expect(info.git_sha).toBe("unknown");
  });
});

describe("publishRelease", () => {
  it("stores a release with its typed entries", async () => {
    await publishRelease({
      version: "1.2.0", title: "Scanning and labels", released_at: "2026-09-01",
      entries: [
        { type: "feature", summary: "Scan a QR code to open an asset." },
        { type: "fix", summary: "Overdue reminders no longer send twice." },
      ],
    });
    const [release] = await listReleases();
    expect(release).toMatchObject({ version: "1.2.0", title: "Scanning and labels" });
    expect(release.entries).toHaveLength(2);
  });

  it("is idempotent for a version already published", async () => {
    const input = {
      version: "1.2.0", title: "First", released_at: "2026-09-01",
      entries: [{ type: "fix" as const, summary: "x" }],
    };
    await publishRelease(input);
    await publishRelease({ ...input, title: "Updated" });
    const list = await listReleases();
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe("Updated");
  });

  it("orders releases newest first by semantic version", async () => {
    await publishRelease({ version: "1.9.0", title: "b", released_at: "2026-08-01", entries: [] });
    await publishRelease({ version: "1.10.0", title: "c", released_at: "2026-09-01", entries: [] });
    await publishRelease({ version: "1.2.0", title: "a", released_at: "2026-07-01", entries: [] });
    // 1.10.0 sorts above 1.9.0 — a string sort would get this wrong.
    expect((await listReleases()).map((r) => r.version))
      .toEqual(["1.10.0", "1.9.0", "1.2.0"]);
  });
});

describe("unseen tracking", () => {
  it("counts every release as unseen for a new user", async () => {
    await publishRelease({ version: "1.2.0", title: "a", released_at: "2026-09-01", entries: [] });
    await publishRelease({ version: "1.1.0", title: "b", released_at: "2026-08-01", entries: [] });
    await expect(countUnseen(ctx)).resolves.toBe(2);
  });

  it("clears the count once the newest version is acknowledged", async () => {
    await publishRelease({ version: "1.2.0", title: "a", released_at: "2026-09-01", entries: [] });
    await publishRelease({ version: "1.1.0", title: "b", released_at: "2026-08-01", entries: [] });
    await markSeen(ctx, "1.2.0");
    await expect(countUnseen(ctx)).resolves.toBe(0);
  });

  it("counts a newer release published after the acknowledgement", async () => {
    await publishRelease({ version: "1.1.0", title: "b", released_at: "2026-08-01", entries: [] });
    await markSeen(ctx, "1.1.0");
    await publishRelease({ version: "1.2.0", title: "a", released_at: "2026-09-01", entries: [] });
    await expect(countUnseen(ctx)).resolves.toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd api && npx vitest run src/lib/domain/releases.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the migration**

`api/migrations/010_releases.sql`:

```sql
-- Product releases are global, not per-tenant: every organisation runs the same build.
CREATE TABLE releases (
  version     text PRIMARY KEY,
  title       text NOT NULL,
  released_at date NOT NULL,
  entries     jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Sortable form of the semantic version: 1.10.0 must rank above 1.9.0.
  sort_key    text GENERATED ALWAYS AS (
                lpad(split_part(version, '.', 1), 5, '0') || '.' ||
                lpad(split_part(version, '.', 2), 5, '0') || '.' ||
                lpad(split_part(split_part(version, '.', 3), '-', 1), 5, '0')
              ) STORED,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX releases_sort_idx ON releases (sort_key DESC);

CREATE TABLE user_release_seen (
  user_id      uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  seen_version text NOT NULL,
  seen_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_release_seen ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_release_seen FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON user_release_seen
  USING (org_id = current_setting('app.org_id')::uuid)
  WITH CHECK (org_id = current_setting('app.org_id')::uuid);

GRANT SELECT ON releases TO ams_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_release_seen TO ams_app;
```

- [ ] **Step 4: Implement the releases module**

`api/src/lib/domain/releases.ts`:

```ts
import { z } from "zod";
import { pool, withTenant } from "../db";
import type { Ctx } from "../http/handler";

export interface VersionInfo {
  version: string;
  git_sha: string;
  built_at: string;
  api_version: string;
  migration_head: string;
  environment: string;
}

/**
 * Build metadata comes from environment variables baked in at image build time,
 * never from a file that could drift from the running code.
 */
export async function getVersionInfo(): Promise<VersionInfo> {
  let migrationHead = "unknown";
  try {
    const { rows } = await pool.query<{ filename: string }>(
      "SELECT filename FROM schema_migrations ORDER BY filename DESC LIMIT 1",
    );
    migrationHead = rows[0]?.filename ?? "none";
  } catch {
    migrationHead = "unavailable";
  }

  return {
    version: process.env.APP_VERSION ?? "0.0.0-dev",
    git_sha: process.env.GIT_SHA ?? "unknown",
    built_at: process.env.BUILT_AT ?? new Date(0).toISOString(),
    api_version: "v1",
    migration_head: migrationHead,
    environment: process.env.NODE_ENV ?? "development",
  };
}

export const ReleaseEntry = z.object({
  type: z.enum(["feature", "improvement", "fix", "breaking"]),
  summary: z.string().min(1).max(500),
  help_url: z.string().url().nullish(),
  api_affecting: z.boolean().default(false),
});

export const ReleaseInput = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+(-[\w.]+)?$/, "must be a semantic version"),
  title: z.string().min(1).max(200),
  released_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entries: z.array(ReleaseEntry),
});
export type ReleaseInput = z.infer<typeof ReleaseInput>;

export interface Release {
  version: string;
  title: string;
  released_at: string;
  entries: z.infer<typeof ReleaseEntry>[];
}

export const listReleases = async (limit = 50): Promise<Release[]> =>
  (await pool.query<Release>(
    `SELECT version, title, to_char(released_at, 'YYYY-MM-DD') AS released_at, entries
       FROM releases ORDER BY sort_key DESC LIMIT $1`,
    [limit],
  )).rows;

/** Idempotent: re-publishing a version updates it rather than failing the deploy. */
export async function publishRelease(raw: ReleaseInput): Promise<void> {
  const input = ReleaseInput.parse(raw);
  await pool.query(
    `INSERT INTO releases (version, title, released_at, entries)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (version) DO UPDATE SET
       title = excluded.title,
       released_at = excluded.released_at,
       entries = excluded.entries`,
    [input.version, input.title, input.released_at, JSON.stringify(input.entries)],
  );
}

export const markSeen = (ctx: Ctx, version: string) =>
  withTenant(ctx.orgId, (c) =>
    c.query(
      `INSERT INTO user_release_seen (user_id, org_id, seen_version)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET
         seen_version = excluded.seen_version, seen_at = now()`,
      [ctx.actor.id, ctx.orgId, version],
    ),
  );

/** Releases ranked above whatever the user last acknowledged. */
export async function countUnseen(ctx: Ctx): Promise<number> {
  const seen = await withTenant(ctx.orgId, async (c) =>
    (await c.query<{ seen_version: string }>(
      "SELECT seen_version FROM user_release_seen WHERE user_id = $1",
      [ctx.actor.id],
    )).rows[0]?.seen_version ?? null,
  );

  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM releases
      WHERE $1::text IS NULL
         OR sort_key > (SELECT sort_key FROM releases WHERE version = $1)`,
    [seen],
  );
  return Number(rows[0].count);
}
```

- [ ] **Step 5: Implement the route handlers and build provenance**

`api/src/app/api/version/route.ts`:

```ts
import { getVersionInfo } from "@/lib/domain/releases";
import { safe } from "@/lib/http/handler";

// Public and unauthenticated — this is the first thing anyone checks when
// something looks wrong.
export const GET = safe(async () =>
  Response.json(await getVersionInfo(), {
    headers: { "cache-control": "no-store" },
  }),
);
```

`api/src/app/api/releases/route.ts`:

```ts
import { listReleases } from "@/lib/domain/releases";
import { safe } from "@/lib/http/handler";

export const GET = safe(async () =>
  Response.json({ data: await listReleases() }, {
    headers: { "cache-control": "public, max-age=300" },
  }),
);
```

`api/src/app/api/admin/releases/seen/route.ts`:

```ts
import { z } from "zod";
import { readSession } from "@/lib/auth/session";
import { unauthorized, validationProblem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { markSeen } from "@/lib/domain/releases";

const Body = z.object({ version: z.string().min(1).max(40) });

export const POST = safe(async (req: Request) => {
  const ctx = await readSession(req);
  if (!ctx) return unauthorized();
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);
  await markSeen(ctx, parsed.data.version);
  return new Response(null, { status: 204 });
});
```

`api/src/app/api/admin/releases/unseen/route.ts`:

```ts
import { readSession } from "@/lib/auth/session";
import { unauthorized } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { countUnseen } from "@/lib/domain/releases";

export const GET = safe(async (req: Request) => {
  const ctx = await readSession(req);
  if (!ctx) return unauthorized();
  return Response.json({ count: await countUnseen(ctx) });
});
```

Deepen the health check in `api/src/app/api/health/route.ts`:

```ts
import { pool } from "@/lib/db";

export async function GET() {
  const checks = { db: false, migrations: false };
  try {
    await pool.query("SELECT 1");
    checks.db = true;
    const { rows } = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM schema_migrations",
    );
    // Zero applied migrations means the container started before `npm run migrate`.
    checks.migrations = Number(rows[0].count) > 0;
  } catch {
    // Both checks stay false; the status code below reflects that.
  }

  const ok = checks.db && checks.migrations;
  return Response.json(
    { status: ok ? "ok" : "degraded", ...checks },
    { status: ok ? 200 : 503 },
  );
}
```

> The Task 1 test asserted `{ status: "ok", db: true }`. Update it to the new shape:
> `{ status: "ok", db: true, migrations: true }`.

Add build args to `api/Dockerfile`, in the `runtime` stage:

```dockerfile
ARG APP_VERSION=0.0.0-dev
ARG GIT_SHA=unknown
ARG BUILT_AT
ENV APP_VERSION=$APP_VERSION \
    GIT_SHA=$GIT_SHA \
    BUILT_AT=$BUILT_AT
```

And to `docker-compose.yml` under the `api` service:

```yaml
    build:
      context: ./api
      args:
        APP_VERSION: ${APP_VERSION:-0.0.0-dev}
        GIT_SHA: ${GIT_SHA:-unknown}
        BUILT_AT: ${BUILT_AT:-1970-01-01T00:00:00Z}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd api
MIGRATION_DATABASE_URL=postgres://ams:ams@localhost:5433/ams_test npm run migrate
npx vitest run src/lib/domain/releases.test.ts src/app/api/health
```

Expected: PASS, 9 tests.

- [ ] **Step 7: Commit**

```bash
git add api/migrations/010_releases.sql api/src/lib/domain/releases.ts api/src/app/api api/Dockerfile docker-compose.yml
git commit -m "feat: version endpoint, build provenance and release notes api"
```

---

### Task 48: "What's new" release-notes panel

**Files:**
- Create: `web/src/api/releases.ts`, `web/src/pages/WhatsNew.tsx`
- Modify: `web/src/layout/AppSidebar.tsx` (unseen indicator and version footer)
- Test: `web/src/pages/WhatsNew.test.tsx`

**Interfaces:**
- Consumes: `GET /api/releases`, `GET /api/version`, `POST /api/admin/releases/seen` (all built in Task 47).
- Produces:
  - `releasesApi.list()`, `.version()`, `.markSeen(version)`
  - `<WhatsNew />` — the user-facing changelog
  - `useUnseenReleases()` — the sidebar dot

**Design note (spec §11.5):** users of an asset system notice when a screen changes and
are unsettled when nobody told them. Entries are written for users, not from commit
subjects. Task 47 builds the API side; this task builds the page against it, and both
degrade quietly to an empty state if no releases have been published.

- [ ] **Step 1: Write the failing test**

`web/src/pages/WhatsNew.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import WhatsNew from "./WhatsNew";
import { releasesApi } from "../api/releases";

vi.mock("../api/releases");

const releases = [
  {
    version: "1.2.0", title: "Scanning and labels", released_at: "2026-09-01",
    entries: [
      { type: "feature", summary: "Scan a QR code to open an asset instantly." },
      { type: "fix", summary: "Overdue reminders no longer send twice in a day." },
    ],
  },
  {
    version: "1.1.0", title: "Reporting", released_at: "2026-08-15",
    entries: [{ type: "improvement", summary: "Reports now export to PDF." }],
  },
];

beforeEach(() => {
  vi.mocked(releasesApi.list).mockResolvedValue(releases);
  vi.mocked(releasesApi.markSeen).mockResolvedValue(undefined as never);
});

const setup = () => render(<MemoryRouter><WhatsNew /></MemoryRouter>);

describe("WhatsNew", () => {
  it("lists releases newest first", async () => {
    setup();
    await waitFor(() => expect(screen.getByText("Scanning and labels")).toBeInTheDocument());
    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings[0]).toHaveTextContent("Scanning and labels");
  });

  it("shows the version and date for each release", async () => {
    setup();
    await waitFor(() => expect(screen.getByText("1.2.0")).toBeInTheDocument());
    expect(screen.getByText(/1 Sep 2026/)).toBeInTheDocument();
  });

  it("renders every entry with its type", async () => {
    setup();
    await waitFor(() =>
      expect(screen.getByText(/Scan a QR code/)).toBeInTheDocument());
    expect(screen.getByText("feature")).toBeInTheDocument();
    expect(screen.getByText("fix")).toBeInTheDocument();
  });

  it("marks the newest version as seen once viewed", async () => {
    setup();
    await waitFor(() => expect(releasesApi.markSeen).toHaveBeenCalledWith("1.2.0"));
  });

  it("shows an empty state when nothing has been published", async () => {
    vi.mocked(releasesApi.list).mockResolvedValue([]);
    setup();
    await waitFor(() =>
      expect(screen.getByText(/No release notes yet/i)).toBeInTheDocument());
  });

  it("does not crash when the release endpoint is unavailable", async () => {
    vi.mocked(releasesApi.list).mockRejectedValue(new Error("offline"));
    setup();
    await waitFor(() =>
      expect(screen.getByText(/No release notes yet/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run src/pages/WhatsNew.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the releases API module and page**

`web/src/api/releases.ts`:

```ts
import { api } from "./client";

export type EntryType = "feature" | "improvement" | "fix" | "breaking";

export interface ReleaseEntry {
  type: EntryType;
  summary: string;
  help_url?: string | null;
  api_affecting?: boolean;
}

export interface Release {
  version: string;
  title: string;
  released_at: string;
  entries: ReleaseEntry[];
}

export interface VersionInfo {
  version: string;
  git_sha: string;
  built_at: string;
  api_version: string;
  migration_head: string;
  environment: string;
}

export const releasesApi = {
  list: () => api.get<Release[]>("/api/releases"),
  version: () => api.get<VersionInfo>("/api/version"),
  markSeen: (version: string) =>
    api.post("/api/admin/releases/seen", { version }),
  unseenCount: () => api.get<{ count: number }>("/api/admin/releases/unseen"),
};
```

`web/src/pages/WhatsNew.tsx`:

```tsx
import { useEffect, useState } from "react";
import PageMeta from "../components/common/PageMeta";
import PageBreadcrumb from "../components/common/PageBreadCrumb";
import Badge from "../components/ui/badge/Badge";
import { releasesApi, type Release, type EntryType } from "../api/releases";

const TYPE_COLOR: Record<EntryType, "success" | "info" | "warning" | "error"> = {
  feature: "success",
  improvement: "info",
  fix: "warning",
  breaking: "error",
};

const asDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });

export default function WhatsNew() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    releasesApi.list()
      .then((list) => {
        setReleases(list);
        // Opening the page is the acknowledgement — it clears the sidebar dot.
        if (list[0]) void releasesApi.markSeen(list[0].version).catch(() => undefined);
      })
      .catch(() => setReleases([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <PageMeta title="What's new | AMS" description="Release notes" />
      <PageBreadcrumb pageTitle="What's new" />

      {loading ? (
        <p className="text-sm text-gray-500">Loading release notes…</p>
      ) : releases.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center dark:border-gray-800 dark:bg-white/[0.03]">
          <h3 className="text-base font-medium text-gray-800 dark:text-white/90">
            No release notes yet
          </h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-500 dark:text-gray-400">
            When a new version ships, what changed will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {releases.map((release) => (
            <article
              key={release.version}
              className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]"
            >
              <div className="flex flex-wrap items-baseline gap-3">
                <h2 className="text-lg font-medium text-gray-800 dark:text-white/90">
                  {release.title}
                </h2>
                <Badge color="light" size="sm">{release.version}</Badge>
                <time
                  className="ml-auto text-theme-xs text-gray-400"
                  dateTime={release.released_at}
                >
                  {asDate(release.released_at)}
                </time>
              </div>

              <ul className="mt-4 space-y-3">
                {release.entries.map((entry, index) => (
                  <li key={index} className="flex flex-wrap items-baseline gap-2">
                    <Badge color={TYPE_COLOR[entry.type]} size="sm">{entry.type}</Badge>
                    <span className="flex-1 text-sm text-gray-700 dark:text-gray-300">
                      {entry.summary}
                      {entry.help_url && (
                        <>
                          {" "}
                          <a
                            href={entry.help_url}
                            className="text-brand-500 hover:text-brand-600"
                          >
                            Learn more
                          </a>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Add the sidebar indicator and version footer**

In `web/src/layout/AppSidebar.tsx`, replace the template's `SidebarWidget` with a version
footer, and mark the "What's new" nav item when there are unseen releases:

```tsx
import { useEffect, useState } from "react";
import { releasesApi, type VersionInfo } from "../api/releases";

function SidebarFooter() {
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [unseen, setUnseen] = useState(0);

  useEffect(() => {
    void releasesApi.version().then(setVersion).catch(() => undefined);
    void releasesApi.unseenCount()
      .then((r) => setUnseen(r.count))
      .catch(() => undefined);
  }, []);

  if (!version) return null;

  return (
    <div className="mt-auto px-5 py-4 text-theme-xs text-gray-400">
      <a href="/whats-new" className="flex items-center gap-2 hover:text-brand-500">
        <span>v{version.version}</span>
        {unseen > 0 && (
          <span
            aria-label={`${unseen} unread release notes`}
            className="h-2 w-2 rounded-full bg-brand-500"
          />
        )}
      </a>
      <span className="mt-1 block font-mono">{version.git_sha}</span>
    </div>
  );
}
```

Render `<SidebarFooter />` where `SidebarWidget` was, and delete
`web/src/layout/SidebarWidget.tsx`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd web && npx vitest run src/pages/WhatsNew.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 6: Run the whole web suite**

Run: `cd web && npm test`
Expected: PASS — every suite from Tasks 21–48 green.

- [ ] **Step 7: Commit**

```bash
git add web/src/api/releases.ts web/src/pages/WhatsNew.tsx web/src/layout
git commit -m "feat: what's new release notes panel with unseen indicator"
```

---


### Task 49: CI pipeline, changelog generation and the release runbook

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/release.yml`
- Create: `api/scripts/changelog.ts`
- Create: `CHANGELOG.md`, `CONTRIBUTING.md`
- Create: `.github/pull_request_template.md`
- Test: `api/scripts/changelog.test.ts`

**Interfaces:**
- Consumes: `git log`, Conventional Commits, `publishRelease` (Task 47).
- Produces:
  - `parseCommits(log): ParsedCommit[]`
  - `groupForChangelog(commits): { features, fixes, other, breaking }`
  - `nextVersion(current, commits): string` — SemVer bump from commit types
  - `buildReleaseNotes(commits): ReleaseInput["entries"]` — user-facing entries from `release-note:` trailers
  - `npm run changelog -- --from v1.4.0 --to HEAD` → updates `CHANGELOG.md` and publishes the release row

**Design note (spec §11.2):** the changelog is generated from commits, not written by
hand, which is why the Conventional Commits constraint is not cosmetic. A `feat:` prefix
on a bug fix produces a wrong release note for real users.

- [ ] **Step 1: Write the failing test**

`api/scripts/changelog.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  parseCommits, groupForChangelog, nextVersion, buildReleaseNotes,
} from "./changelog";

const LOG = [
  "abc1234\x1ffeat(assets): add qr code scanning\x1fScan a QR code to open an asset instantly.\x1f",
  "def5678\x1ffix(email): stop duplicate overdue reminders\x1fOverdue reminders no longer send twice in one day.\x1f",
  "ghi9012\x1fchore(deps): bump vite\x1f\x1f",
  "jkl3456\x1ffeat(api)!: rename asset.tag to asset.asset_tag\x1fThe asset tag field is now named asset_tag.\x1fBREAKING CHANGE: `tag` is now `asset_tag`.",
].join("\n");

describe("parseCommits", () => {
  it("reads type, scope and subject from each commit", () => {
    const commits = parseCommits(LOG);
    expect(commits[0]).toMatchObject({
      type: "feat", scope: "assets", subject: "add qr code scanning",
    });
  });

  it("reads the release-note body", () => {
    expect(parseCommits(LOG)[0].releaseNote)
      .toBe("Scan a QR code to open an asset instantly.");
  });

  it("flags a breaking change from the ! marker", () => {
    expect(parseCommits(LOG)[3].breaking).toBe(true);
  });

  it("flags a breaking change from the footer", () => {
    const log = "aaa\x1ffix: x\x1f\x1fBREAKING CHANGE: it moved";
    expect(parseCommits(log)[0].breaking).toBe(true);
  });

  it("ignores a commit that is not conventional", () => {
    expect(parseCommits("aaa\x1fwip stuff\x1f\x1f")).toHaveLength(0);
  });
});

describe("nextVersion", () => {
  it("bumps patch for fixes only", () => {
    expect(nextVersion("1.4.2", parseCommits("a\x1ffix: x\x1f\x1f"))).toBe("1.4.3");
  });

  it("bumps minor for a feature", () => {
    expect(nextVersion("1.4.2", parseCommits("a\x1ffeat: x\x1f\x1f"))).toBe("1.5.0");
  });

  it("bumps major for a breaking change", () => {
    expect(nextVersion("1.4.2", parseCommits(LOG))).toBe("2.0.0");
  });

  it("bumps patch when only chores are present", () => {
    expect(nextVersion("1.4.2", parseCommits("a\x1fchore: x\x1f\x1f"))).toBe("1.4.3");
  });
});

describe("groupForChangelog", () => {
  it("groups commits by their type", () => {
    const groups = groupForChangelog(parseCommits(LOG));
    expect(groups.features).toHaveLength(2);
    expect(groups.fixes).toHaveLength(1);
    expect(groups.other).toHaveLength(1);
    expect(groups.breaking).toHaveLength(1);
  });
});

describe("buildReleaseNotes", () => {
  it("produces user-facing entries from the release notes, not the subjects", () => {
    const entries = buildReleaseNotes(parseCommits(LOG));
    expect(entries).toContainEqual(expect.objectContaining({
      type: "feature", summary: "Scan a QR code to open an asset instantly.",
    }));
  });

  it("marks a breaking entry as breaking", () => {
    expect(buildReleaseNotes(parseCommits(LOG))).toContainEqual(
      expect.objectContaining({ type: "breaking" }),
    );
  });

  it("omits commits with no release note — chores are not user-facing", () => {
    const entries = buildReleaseNotes(parseCommits(LOG));
    expect(entries.some((e) => e.summary.includes("vite"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd api && npx vitest run scripts/changelog.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the changelog generator**

`api/scripts/changelog.ts`:

```ts
import { execSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { publishRelease } from "../src/lib/domain/releases";

export interface ParsedCommit {
  sha: string;
  type: string;
  scope: string | null;
  subject: string;
  releaseNote: string | null;
  breaking: boolean;
}

const HEADER = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;
const SEP = "\x1f";

export function parseCommits(log: string): ParsedCommit[] {
  const commits: ParsedCommit[] = [];

  for (const line of log.split("\n")) {
    if (!line.trim()) continue;
    const [sha, header, note, footer] = line.split(SEP);
    const match = HEADER.exec(header ?? "");
    // Anything not following Conventional Commits is invisible to the changelog.
    if (!match) continue;

    commits.push({
      sha: sha?.trim() ?? "",
      type: match[1],
      scope: match[2] ?? null,
      subject: match[4],
      releaseNote: note?.trim() || null,
      breaking: Boolean(match[3]) || /BREAKING CHANGE:/.test(footer ?? ""),
    });
  }
  return commits;
}

export function nextVersion(current: string, commits: ParsedCommit[]): string {
  const [major, minor, patch] = current.replace(/^v/, "").split(".").map(Number);

  if (commits.some((c) => c.breaking)) return `${major + 1}.0.0`;
  if (commits.some((c) => c.type === "feat")) return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

export function groupForChangelog(commits: ParsedCommit[]) {
  return {
    breaking: commits.filter((c) => c.breaking),
    features: commits.filter((c) => c.type === "feat"),
    fixes: commits.filter((c) => c.type === "fix"),
    performance: commits.filter((c) => c.type === "perf"),
    other: commits.filter(
      (c) => !["feat", "fix", "perf"].includes(c.type),
    ),
  };
}

const ENTRY_TYPE: Record<string, "feature" | "improvement" | "fix"> = {
  feat: "feature",
  perf: "improvement",
  refactor: "improvement",
  fix: "fix",
};

/**
 * User-facing entries come from the `release-note` body, never the commit subject.
 * "fix(email): stop duplicate overdue reminders" is for the team;
 * "Overdue reminders no longer send twice in one day" is for the user.
 */
export function buildReleaseNotes(commits: ParsedCommit[]) {
  return commits
    .filter((c) => c.releaseNote)
    .map((c) => ({
      type: c.breaking ? ("breaking" as const) : ENTRY_TYPE[c.type] ?? ("improvement" as const),
      summary: c.releaseNote!,
      api_affecting: c.scope === "api",
    }));
}

function renderMarkdown(version: string, date: string, commits: ParsedCommit[]): string {
  const groups = groupForChangelog(commits);
  const lines = [`## ${version} — ${date}`, ""];

  const section = (title: string, items: ParsedCommit[]) => {
    if (items.length === 0) return;
    lines.push(`### ${title}`, "");
    for (const commit of items) {
      const scope = commit.scope ? `**${commit.scope}:** ` : "";
      lines.push(`- ${scope}${commit.subject} (${commit.sha.slice(0, 7)})`);
    }
    lines.push("");
  };

  section("⚠ Breaking changes", groups.breaking);
  section("Features", groups.features);
  section("Bug fixes", groups.fixes);
  section("Performance", groups.performance);
  section("Maintenance", groups.other);

  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const from = args[args.indexOf("--from") + 1];
  const to = args.includes("--to") ? args[args.indexOf("--to") + 1] : "HEAD";
  const dryRun = args.includes("--dry-run");

  const range = from ? `${from}..${to}` : to;
  // %H sha, %s subject, %b body, %(trailers) footer — separated by 0x1f so a
  // subject containing a pipe or comma cannot break parsing.
  const log = execSync(
    `git log ${range} --no-merges --pretty=format:"%H${SEP}%s${SEP}%(trailers:key=release-note,valueonly)${SEP}%b"`,
    { encoding: "utf8" },
  );

  const commits = parseCommits(log);
  if (commits.length === 0) {
    console.log("No conventional commits in range — nothing to release.");
    return;
  }

  const current = (from ?? "v0.0.0").replace(/^v/, "");
  const version = nextVersion(current, commits);
  const date = new Date().toISOString().slice(0, 10);

  const markdown = renderMarkdown(version, date, commits);
  console.log(markdown);

  if (dryRun) return;

  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const changelogPath = join(root, "CHANGELOG.md");
  const existing = await readFile(changelogPath, "utf8").catch(
    () => "# Changelog\n\nGenerated from Conventional Commits. Do not edit by hand.\n",
  );
  const [heading, ...rest] = existing.split("\n\n");
  await writeFile(
    changelogPath,
    [heading, markdown, ...rest].join("\n\n"),
    "utf8",
  );

  await publishRelease({
    version,
    title: process.env.RELEASE_TITLE ?? `Version ${version}`,
    released_at: date,
    entries: buildReleaseNotes(commits),
  });

  console.log(`\nRelease ${version} written to CHANGELOG.md and published.`);
}

// Only run when invoked directly, so the test can import the pure functions.
if (process.argv[1]?.endsWith("changelog.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

Add to `api/package.json`:

```json
    "changelog": "tsx scripts/changelog.ts"
```

- [ ] **Step 4: Write the CI workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  api:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_DB: ams_test
          POSTGRES_USER: ams
          POSTGRES_PASSWORD: ams
        ports: ["5433:5432"]
        options: >-
          --health-cmd "pg_isready -U ams -d ams_test"
          --health-interval 5s --health-timeout 5s --health-retries 10
    env:
      DATABASE_URL: postgres://ams_app:ams_app@localhost:5433/ams_test
      MIGRATION_DATABASE_URL: postgres://ams:ams@localhost:5433/ams_test
      APP_ENCRYPTION_KEY: "0000000000000000000000000000000000000000000000000000000000000001"
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm, cache-dependency-path: api/package-lock.json }
      - run: npm ci
        working-directory: api
      - run: npm run migrate
        working-directory: api
      - run: npx tsc --noEmit
        working-directory: api
      - run: npm test
        working-directory: api

  web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm, cache-dependency-path: web/package-lock.json }
      - run: npm ci
        working-directory: web
      - run: npm run lint
        working-directory: web
      - run: npx tsc --noEmit
        working-directory: web
      - run: npm test
        working-directory: web
      - run: npm run build
        working-directory: web

  release-note:
    # Spec §11.5: a user-visible change must carry a user-facing summary.
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - name: Require a release note on feat and fix commits
        run: |
          base="origin/${{ github.base_ref }}"
          git fetch origin "${{ github.base_ref }}" --depth=50
          missing=0
          while IFS= read -r sha; do
            subject=$(git log -1 --pretty=%s "$sha")
            case "$subject" in
              feat*|fix*)
                if ! git log -1 --pretty='%(trailers:key=release-note,valueonly)' "$sha" | grep -q '[^[:space:]]'; then
                  echo "::error::$sha ($subject) has no 'release-note:' trailer"
                  missing=1
                fi
                ;;
            esac
          done < <(git rev-list "$base"..HEAD --no-merges)
          exit $missing
```

`.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags: ["v*"]

jobs:
  release:
    runs-on: ubuntu-latest
    permissions: { contents: write, packages: write }
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }

      - name: Derive build metadata
        id: meta
        run: |
          echo "version=${GITHUB_REF_NAME#v}" >> "$GITHUB_OUTPUT"
          echo "sha=$(git rev-parse --short HEAD)" >> "$GITHUB_OUTPUT"
          echo "built_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$GITHUB_OUTPUT"

      - name: Build and push images
        run: |
          docker build ./api \
            --build-arg APP_VERSION=${{ steps.meta.outputs.version }} \
            --build-arg GIT_SHA=${{ steps.meta.outputs.sha }} \
            --build-arg BUILT_AT=${{ steps.meta.outputs.built_at }} \
            -t ghcr.io/${{ github.repository }}/api:${{ steps.meta.outputs.version }} \
            -t ghcr.io/${{ github.repository }}/api:latest
          docker build ./web \
            --build-arg VITE_API_BASE_URL=${{ vars.API_PUBLIC_URL }} \
            -t ghcr.io/${{ github.repository }}/web:${{ steps.meta.outputs.version }} \
            -t ghcr.io/${{ github.repository }}/web:latest
          echo "${{ secrets.GITHUB_TOKEN }}" | docker login ghcr.io -u ${{ github.actor }} --password-stdin
          docker push --all-tags ghcr.io/${{ github.repository }}/api
          docker push --all-tags ghcr.io/${{ github.repository }}/web

      - name: Publish the OpenAPI document as a release asset
        run: |
          node -e "
            import('./api/src/lib/openapi/document.ts').then(async (m) => {
              const fs = await import('node:fs/promises');
              await fs.writeFile('openapi.json', JSON.stringify(m.buildOpenApiDocument(), null, 2));
            });
          " || echo "generate openapi.json with the api container instead"

      - uses: softprops/action-gh-release@v2
        with:
          files: openapi.json
          generate_release_notes: true
```

- [ ] **Step 5: Write the contributor and PR templates**

`.github/pull_request_template.md`:

```markdown
## What changed

<!-- One paragraph. What does this do, and why? -->

## Release note

<!-- Required for feat: and fix: commits. One sentence, written for a user of the
     dashboard — not a commit subject. This becomes the "What's new" entry.
     Also add it as a `release-note:` trailer on the commit itself. -->

release-note:

## Checklist

- [ ] Tests written first, and they failed before the implementation
- [ ] `npm test` passes in `api/` and `web/`
- [ ] Commits follow Conventional Commits (`feat:`, `fix:`, `chore:`, …)
- [ ] Migration is additive — the previous image still runs against this schema
- [ ] Public API changes are additive to v1, or introduce v2
- [ ] Documentation updated if behaviour changed
```

`CONTRIBUTING.md`:

```markdown
# Contributing

## Branches and commits

- `main` is always deployable. Branch as `feat/<slug>`, `fix/<slug>` or `chore/<slug>`.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/). The
  changelog and the version bump are generated from them, so the prefix is not
  cosmetic — a `feat:` on a bug fix produces a wrong release note for real users.
- Any `feat:` or `fix:` commit carries a `release-note:` trailer written for a user
  of the dashboard. CI fails without one.

```
feat(assets): add qr code scanning

release-note: Scan a QR code with your phone camera to open an asset instantly.
```

## Tests

Test-first, always: write the failing test, run it to confirm it fails, implement,
re-run. `npm test` in both `api/` and `web/`.

## Migrations

Forward-only and additive within a release: add a column, backfill, start writing, and
drop the old column in a *later* release. That is what makes a rollback a redeploy of
the previous image rather than a database restore.

## Releasing

```bash
npm run changelog -- --from v1.4.0 --to HEAD --dry-run   # review
npm run changelog -- --from v1.4.0 --to HEAD             # write + publish
git commit -am "chore(release): v1.5.0"
git tag -a v1.5.0 -m "v1.5.0"
git push origin main --tags
```

Then: migrate → deploy the new image → verify `/api/version` and `/api/health` →
announce. Rollback is a redeploy of the previous image tag.
```

`CHANGELOG.md`:

```markdown
# Changelog

Generated from Conventional Commits by `npm run changelog`. Do not edit by hand.
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd api && npx vitest run scripts/changelog.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 7: Verify the generator against real history**

```bash
cd api && npm run changelog -- --dry-run
```

Expected: a rendered markdown block grouping this project's own commits so far.

- [ ] **Step 8: Commit**

```bash
git add .github CHANGELOG.md CONTRIBUTING.md api/scripts/changelog.ts api/package.json
git commit -m "chore: ci pipeline, changelog generation and release runbook"
```

---

**Phase 7 complete.** The API is documented, integrable and releasable: idempotent
writes, signed webhooks, a generated OpenAPI contract, build provenance, and a release
pipeline that produces both a technical changelog and user-facing release notes.
Continue to [Phase 8 — Docs & enablement](./08-docs-enablement.md).
