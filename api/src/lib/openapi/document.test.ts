import { describe, it, expect } from "vitest";
import { buildOpenApiDocument } from "./document";

const doc = buildOpenApiDocument();

type Operation = { responses: Record<string, unknown>; parameters?: unknown };
const operations = (): [string, string, Operation][] => {
  const out: [string, string, Operation][] = [];
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const [method, operation] of Object.entries(item as object)) {
      if (["get", "post", "patch", "put", "delete"].includes(method)) {
        out.push([path, method, operation as Operation]);
      }
    }
  }
  return out;
};

describe("buildOpenApiDocument", () => {
  it("declares OpenAPI 3.1 with a titled, versioned info block", () => {
    expect(doc.openapi).toMatch(/^3\.1/);
    expect(doc.info.title).toBeTruthy();
    expect(doc.info.version).toBeTruthy();
  });

  it("documents every public endpoint", () => {
    const paths = Object.keys(doc.paths ?? {});
    for (const path of [
      "/assets", "/assets/{id}", "/assets/{id}/checkout", "/assets/{id}/checkin",
      "/assets/{id}/history", "/assets/lookup", "/categories", "/locations",
      "/users", "/imports", "/dashboard/summary", "/reports", "/reports/{key}",
      "/webhooks", "/webhooks/{id}", "/stocktakes", "/maintenance/schedules",
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

  it("generates request schemas from the Zod inputs the handlers validate with", () => {
    // Hand-written schemas drift within a month. These come from the same
    // objects the routes parse, so they cannot describe a field that is not
    // really accepted.
    const schema = doc.components?.schemas?.AssetInput as { properties?: object };
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining(["name", "serial_no", "status", "custom"]),
    );
  });

  it("carries the depreciation policy that was added later", () => {
    // A generated document picks up a new field for free; a hand-written one
    // would still describe the API as it was in Phase 2.
    const schema = doc.components?.schemas?.AssetInput as {
      properties?: Record<string, unknown>;
    };
    expect(Object.keys(schema.properties ?? {})).toContain("depreciation_start");
  });

  it("documents the paginated envelope on a list", () => {
    expect(JSON.stringify(doc.paths?.["/assets"]?.get)).toContain("meta");
  });

  it("documents problem+json on every operation that can refuse one", () => {
    for (const [path, method, operation] of operations()) {
      const codes = Object.keys(operation.responses);
      expect(codes, `${method} ${path} documents no 401`).toContain("401");
      expect(codes, `${method} ${path} documents no 429`).toContain("429");
    }
  });

  it("documents 422 wherever a body or query is validated", () => {
    for (const [path, method, operation] of operations()) {
      if (method === "delete") continue;
      expect(Object.keys(operation.responses), `${method} ${path}`).toContain("422");
    }
  });

  it("documents pagination and sort on the asset list", () => {
    const params = JSON.stringify(doc.paths?.["/assets"]?.get?.parameters);
    expect(params).toContain("page");
    expect(params).toContain("per_page");
    expect(params).toContain("sort");
  });

  it("documents the Idempotency-Key header on the writes that honour it", () => {
    // Documenting it where it is not honoured would be worse than silence: an
    // integrator would trust a retry that duplicates.
    const params = JSON.stringify(doc.paths?.["/assets"]?.post?.parameters);
    expect(params).toContain("Idempotency-Key");
  });

  it("does not claim idempotency on a write that has none", () => {
    const params = JSON.stringify(doc.paths?.["/categories"]?.post?.parameters ?? []);
    expect(params).not.toContain("Idempotency-Key");
  });

  it("groups operations under tags that are all declared", () => {
    const declared = new Set(doc.tags?.map((t) => t.name));
    expect(declared).toContain("Assets");
    expect(declared).toContain("Webhooks");

    for (const [path, method, operation] of operations()) {
      for (const tag of (operation as { tags?: string[] }).tags ?? []) {
        expect(declared, `${method} ${path} uses undeclared tag ${tag}`).toContain(tag);
      }
    }
  });

  it("gives every operation an operationId, which code generators need", () => {
    const seen = new Set<string>();
    for (const [path, method, operation] of operations()) {
      const id = (operation as { operationId?: string }).operationId;
      expect(id, `${method} ${path} has no operationId`).toBeTruthy();
      expect(seen.has(id!), `duplicate operationId ${id}`).toBe(false);
      seen.add(id!);
    }
  });

  it("is valid JSON, because that is how it is served", () => {
    expect(() => JSON.parse(JSON.stringify(doc))).not.toThrow();
  });
});
