import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { withTenant } from "@/lib/db";
import { createOrg, createUserWithRole } from "@/test/org";
import { createSession } from "@/lib/auth/session";
import { PERMISSIONS, type PermissionKey } from "@/lib/auth/permissions";
import type { Ctx } from "@/lib/http/handler";
import { createCategory } from "@/lib/domain/categories";
import { createWebhook } from "@/lib/domain/webhooks";
import { POST } from "./route";
import { GET as GET_JOB } from "./[id]/route";

let orgId: string;
let adminCtx: Ctx;
let categoryId: string;
let managerSession: string;
let technicianSession: string;
let scopedSession: string;

const CSV = `Asset Name,Serial Number,Status
Imported One,IMP-001,available
Imported Two,IMP-002,in_use
`;

function upload(
  session: string,
  fields: Record<string, string>,
  csv = CSV,
  filename = "assets.csv",
) {
  const form = new FormData();
  form.set("file", new File([csv], filename, { type: "text/csv" }));
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return new Request("http://api.test/api/v1/imports", {
    method: "POST",
    headers: { cookie: `ams_session=${session}` },
    body: form,
  });
}

beforeAll(async () => {
  orgId = await createOrg("Import Routes Org");
  const admin = await createUserWithRole(orgId, "Administrator");
  adminCtx = {
    orgId,
    actor: {
      type: "user", id: admin.id, label: "Admin", scopes: ["admin"],
      permissions: PERMISSIONS.map((p) => p.key) as PermissionKey[],
      locationScope: null,
    },
  };
  categoryId = (await createCategory(adminCtx, {
    name: "Imported", kind: "it", field_schema: { fields: [] },
  })).id;

  managerSession = await createSession(
    (await createUserWithRole(orgId, "Manager")).id, orgId);
  technicianSession = await createSession(
    (await createUserWithRole(orgId, "Technician")).id, orgId);

  const location = await withTenant(orgId, async (c) =>
    (await c.query<{ id: string }>(
      "INSERT INTO locations (org_id, name) VALUES ($1,'Depot') RETURNING id", [orgId],
    )).rows[0].id,
  );
  const scoped = await createUserWithRole(orgId, "Manager");
  await withTenant(orgId, (c) =>
    c.query(
      `INSERT INTO user_location_scopes (org_id, user_id, location_id)
       VALUES ($1, $2, $3)`,
      [orgId, scoped.id, location],
    ),
  );
  scopedSession = await createSession(scoped.id, orgId);
});

describe("authorization", () => {
  it("refuses an unauthenticated caller", async () => {
    const form = new FormData();
    form.set("file", new File([CSV], "a.csv"));
    const res = await POST(new Request("http://api.test/api/v1/imports", {
      method: "POST", body: form,
    }));
    expect(res.status).toBe(401);
  });

  it("refuses a technician, who cannot import", async () => {
    expect((await POST(upload(technicianSession, {}))).status).toBe(403);
  });

  it("refuses a branch-scoped user with an explanation", async () => {
    // Imported assets have no location, so a scoped user would create records
    // they cannot then see.
    const res = await POST(upload(scopedSession, {}));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { detail: string }).detail).toMatch(/branches/i);
  });
});

describe("the mapping step", () => {
  it("returns headers, a sample and a suggested mapping when no mapping is sent", async () => {
    const res = await POST(upload(managerSession, {}));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      headers: string[];
      row_count: number;
      sample: unknown[];
      suggested_mapping: Record<string, string>;
    };
    expect(body.headers).toEqual(["Asset Name", "Serial Number", "Status"]);
    expect(body.row_count).toBe(2);
    expect(body.sample).toHaveLength(2);
    expect(body.suggested_mapping).toMatchObject({
      "Asset Name": "name", "Serial Number": "serial_no", "Status": "status",
    });
  });

  it("rejects a malformed mapping with 422", async () => {
    const res = await POST(upload(managerSession, { mapping: "not json" }));
    expect(res.status).toBe(422);
  });

  it("rejects a file with no data rows", async () => {
    const res = await POST(upload(managerSession, {}, "Asset Name,Serial Number\n"));
    expect(res.status).toBe(422);
  });

  it("rejects a request with no file", async () => {
    const form = new FormData();
    form.set("mapping", "{}");
    const res = await POST(new Request("http://api.test/api/v1/imports", {
      method: "POST",
      headers: { cookie: `ams_session=${managerSession}` },
      body: form,
    }));
    expect(res.status).toBe(422);
  });
});

describe("running the import", () => {
  const mapping = JSON.stringify({
    "Asset Name": "name", "Serial Number": "serial_no", "Status": "status",
  });

  it("defaults to a dry run when the flag is absent", async () => {
    // Forgetting dry_run must preview, not rewrite the register.
    const res = await POST(upload(managerSession, { mapping, category_id: categoryId }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { created: number };
    expect(body.created).toBe(2);
  });

  it("commits only when dry_run is explicitly false", async () => {
    const res = await POST(upload(managerSession, {
      mapping, category_id: categoryId, dry_run: "false",
    }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { created: number; job_id: string };
    expect(body.created).toBe(2);

    const job = await GET_JOB(
      new Request(`http://api.test/api/v1/imports/${body.job_id}`, {
        headers: { cookie: `ams_session=${managerSession}` },
      }),
      { params: Promise.resolve({ id: body.job_id }) },
    );
    expect(job.status).toBe(200);
    expect((await job.json()) as { dry_run: boolean }).toMatchObject({ dry_run: false });
  });

  it("reports an unknown job as not found", async () => {
    const id = "00000000-0000-0000-0000-000000000000";
    const res = await GET_JOB(
      new Request(`http://api.test/api/v1/imports/${id}`, {
        headers: { cookie: `ams_session=${managerSession}` },
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(404);
  });
});

describe("announcing a finished import", () => {
  const mapping = JSON.stringify({
    "Asset Name": "name", "Serial Number": "serial_no", "Status": "status",
  });

  const queued = () =>
    withTenant(orgId, async (c) =>
      (await c.query<{ event: string }>(
        "SELECT event FROM webhook_deliveries ORDER BY created_at",
      )).rows.map((r) => r.event),
    );

  beforeAll(async () => {
    await createWebhook(adminCtx, {
      url: "https://example.test/imports", events: ["import.completed"],
    });
  });

  beforeEach(() =>
    withTenant(orgId, (c) => c.query("DELETE FROM webhook_deliveries")),
  );

  it("tells a subscriber when a committed import finishes", async () => {
    // There has been a default email rule and a template for this event since
    // the notifications work; nothing ever fired them.
    await POST(upload(managerSession, {
      mapping, category_id: categoryId, dry_run: "false",
    }));
    expect(await queued()).toEqual(["import.completed"]);
  });

  it("says nothing about a dry run, which changed nothing", async () => {
    await POST(upload(managerSession, { mapping, category_id: categoryId }));
    expect(await queued()).toEqual([]);
  });

  it("carries the counts, so a subscriber need not fetch the job", async () => {
    await POST(upload(managerSession, {
      mapping, category_id: categoryId, dry_run: "false",
    }));
    const payload = await withTenant(orgId, async (c) =>
      (await c.query<{ payload: Record<string, unknown> }>(
        "SELECT payload FROM webhook_deliveries LIMIT 1",
      )).rows[0].payload,
    );
    expect(payload).toMatchObject({
      import: { total: 2, filename: "assets.csv" },
    });
  });
});

describe("the email a finished import sends", () => {
  const mapping = JSON.stringify({
    "Asset Name": "name", "Serial Number": "serial_no", "Status": "status",
  });

  const queuedEmails = () =>
    withTenant(orgId, async (c) =>
      (await c.query<{ subject: string; text_body: string }>(
        `SELECT subject, text_body FROM email_messages
          WHERE event = 'import.completed' ORDER BY created_at DESC`,
      )).rows,
    );

  beforeEach(() =>
    withTenant(orgId, (c) =>
      c.query("DELETE FROM email_messages WHERE event = 'import.completed'"),
    ),
  );

  it("names the file and the counts rather than leaving blanks", async () => {
    // The template reads {{import.filename}} and {{import.total}}. Handing it
    // those values flat renders "Import finished:" with nothing after it, and
    // an email that says nothing is worse than no email.
    await POST(upload(managerSession, {
      mapping, category_id: categoryId, dry_run: "false",
    }));

    const [email] = await queuedEmails();
    expect(email).toBeDefined();
    expect(email.subject).toContain("assets.csv");
    expect(email.text_body).toContain("2 rows");
    expect(email.text_body).not.toContain("{{");
  });

  it("links to a page that exists", async () => {
    // /import/<id> is a real route; it was not until the result page was built.
    await POST(upload(managerSession, {
      mapping, category_id: categoryId, dry_run: "false",
    }));

    const [email] = await queuedEmails();
    expect(email.text_body).toMatch(/\/import\/[0-9a-f-]{36}/);
  });
});
