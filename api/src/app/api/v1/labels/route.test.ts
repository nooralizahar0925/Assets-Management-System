import { describe, it, expect, beforeAll } from "vitest";
import { withTenant } from "@/lib/db";
import { createOrg, createUserWithRole } from "@/test/org";
import { createSession } from "@/lib/auth/session";
import { PERMISSIONS, type PermissionKey } from "@/lib/auth/permissions";
import type { Ctx } from "@/lib/http/handler";
import { createAsset } from "@/lib/domain/assets";
import { GET as LOOKUP } from "../assets/lookup/route";
import { GET as TEMPLATES, POST as SHEET } from "./sheet/route";
import { GET as LABEL_PNG } from "../assets/[id]/label.png/route";
import { GET as LABEL_SVG } from "../assets/[id]/label.svg/route";

let orgId: string;
let adminCtx: Ctx;
let technicianSession: string;
let viewerSession: string;
let scopedSession: string;
let assetId: string;
let assetTag: string;
let jakartaAssetId: string;

const get = (session: string, url: string) =>
  new Request(url, { headers: { cookie: `ams_session=${session}` } });

const withId = (session: string, url: string, id: string) => ({
  request: get(session, url),
  ctx: { params: Promise.resolve({ id }) },
});

const post = (session: string, body: unknown) =>
  new Request("http://api.test/api/v1/labels/sheet", {
    method: "POST",
    headers: { cookie: `ams_session=${session}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  orgId = await createOrg("Label Routes Org");
  const admin = await createUserWithRole(orgId, "Administrator");
  adminCtx = {
    orgId,
    actor: {
      type: "user", id: admin.id, label: "Admin", scopes: ["admin"],
      permissions: PERMISSIONS.map((p) => p.key) as PermissionKey[],
      locationScope: null,
    },
  };

  const [jakarta, bekasi] = await withTenant(orgId, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `INSERT INTO locations (org_id, name) VALUES ($1,'Jakarta'), ($1,'Bekasi')
       RETURNING id`,
      [orgId],
    );
    return [rows[0].id, rows[1].id];
  });

  const asset = await createAsset(adminCtx, {
    name: "Scannable", location_id: bekasi,
  });
  assetId = asset.id;
  assetTag = asset.asset_tag;
  jakartaAssetId = (await createAsset(adminCtx, {
    name: "Elsewhere", location_id: jakarta,
  })).id;

  technicianSession = await createSession(
    (await createUserWithRole(orgId, "Technician")).id, orgId);
  viewerSession = await createSession(
    (await createUserWithRole(orgId, "Viewer")).id, orgId);

  const scoped = await createUserWithRole(orgId, "Technician");
  await withTenant(orgId, (c) =>
    c.query(
      `INSERT INTO user_location_scopes (org_id, user_id, location_id)
       VALUES ($1, $2, $3)`,
      [orgId, scoped.id, bekasi],
    ),
  );
  scopedSession = await createSession(scoped.id, orgId);
});

describe("GET /api/v1/assets/lookup", () => {
  it("refuses an unauthenticated caller", async () => {
    const res = await LOOKUP(new Request("http://api.test/api/v1/assets/lookup?tag=X"));
    expect(res.status).toBe(401);
  });

  it("resolves a scanned tag", async () => {
    const res = await LOOKUP(get(
      viewerSession, `http://api.test/api/v1/assets/lookup?tag=${assetTag}`,
    ));
    expect(res.status).toBe(200);
    expect((await res.json()) as { name: string }).toMatchObject({ name: "Scannable" });
  });

  it("resolves a full deep link, as a phone camera would produce", async () => {
    const url = `http://api.test/api/v1/assets/lookup?tag=${
      encodeURIComponent(`http://localhost:3400/a/${assetTag}`)}`;
    const res = await LOOKUP(get(viewerSession, url));
    expect(res.status).toBe(200);
  });

  it("rejects a missing tag with 422", async () => {
    expect((await LOOKUP(get(viewerSession, "http://api.test/api/v1/assets/lookup")))
      .status).toBe(422);
  });

  it("reports an unknown tag as not found", async () => {
    expect((await LOOKUP(get(
      viewerSession, "http://api.test/api/v1/assets/lookup?tag=NOPE-999",
    ))).status).toBe(404);
  });

  it("refuses a scoped user another branch's tag", async () => {
    const other = await createAsset(adminCtx, { name: "Hidden", location_id: null });
    const res = await LOOKUP(get(
      scopedSession, `http://api.test/api/v1/assets/lookup?tag=${other.asset_tag}`,
    ));
    expect(res.status).toBe(403);
  });
});

describe("label images", () => {
  it("serves a PNG label", async () => {
    const { request, ctx } = withId(
      technicianSession,
      `http://api.test/api/v1/assets/${assetId}/label.png`, assetId,
    );
    const res = await LABEL_PNG(request, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await res.arrayBuffer()).subarray(1, 4).toString()).toBe("PNG");
  });

  it("serves an SVG label", async () => {
    const { request, ctx } = withId(
      technicianSession,
      `http://api.test/api/v1/assets/${assetId}/label.svg?symbology=code128`, assetId,
    );
    const res = await LABEL_SVG(request, ctx);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
    expect(await res.text()).toContain("<svg");
  });

  it("refuses a viewer, who cannot print labels", async () => {
    const { request, ctx } = withId(
      viewerSession, `http://api.test/api/v1/assets/${assetId}/label.png`, assetId,
    );
    expect((await LABEL_PNG(request, ctx)).status).toBe(403);
  });

  it("refuses a scoped user another branch's label", async () => {
    const { request, ctx } = withId(
      scopedSession,
      `http://api.test/api/v1/assets/${jakartaAssetId}/label.png`, jakartaAssetId,
    );
    expect((await LABEL_PNG(request, ctx)).status).toBe(403);
  });

  it("reports an unknown asset as not found", async () => {
    const id = "00000000-0000-0000-0000-000000000000";
    const { request, ctx } = withId(
      technicianSession, `http://api.test/api/v1/assets/${id}/label.png`, id,
    );
    expect((await LABEL_PNG(request, ctx)).status).toBe(404);
  });
});

describe("label sheets", () => {
  it("lists the available stock templates", async () => {
    const res = await TEMPLATES(get(
      technicianSession, "http://api.test/api/v1/labels/sheet",
    ));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { key: string; name: string }[] };
    expect(body.data.map((t) => t.key).sort())
      .toEqual(["avery5160", "avery5163", "thermal50x25"]);
  });

  it("builds a printable sheet", async () => {
    const res = await SHEET(post(technicianSession, {
      asset_ids: [assetId], symbology: "qr", template: "avery5160",
    }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("<!doctype html>");
    expect(html).toContain(assetTag);
  });

  it("refuses a viewer", async () => {
    const res = await SHEET(post(viewerSession, { asset_ids: [assetId] }));
    expect(res.status).toBe(403);
  });

  it("rejects an empty asset list", async () => {
    expect((await SHEET(post(technicianSession, { asset_ids: [] }))).status).toBe(422);
  });

  it("rejects more than five hundred labels at the boundary", async () => {
    const ids = Array.from(
      { length: 501 },
      (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
    );
    expect((await SHEET(post(technicianSession, { asset_ids: ids }))).status).toBe(422);
  });
});
