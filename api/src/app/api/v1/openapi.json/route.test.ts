import { describe, it, expect } from "vitest";
import { GET } from "./route";

describe("GET /api/v1/openapi.json", () => {
  it("serves the document without a credential", async () => {
    // An integrator reads the contract before they have a key; that is how
    // they decide whether to build against it.
    const res = await GET(new Request("http://api.test/api/v1/openapi.json"));
    expect(res.status).toBe(200);

    const doc = (await res.json()) as { openapi: string; paths: object };
    expect(doc.openapi).toMatch(/^3\.1/);
    expect(Object.keys(doc.paths).length).toBeGreaterThan(10);
  });

  it("is cacheable, because it only changes when the code does", async () => {
    const res = await GET(new Request("http://api.test/api/v1/openapi.json"));
    expect(res.headers.get("cache-control")).toContain("max-age");
  });

  it("leaks nothing belonging to an organisation", async () => {
    // It describes shapes. A tenant name or id appearing here would mean the
    // document was built from data rather than from schemas.
    const res = await GET(new Request("http://api.test/api/v1/openapi.json"));
    const text = JSON.stringify(await res.json());
    expect(text).not.toMatch(/whsec_/);
    expect(text).not.toMatch(/ams_live_/);
  });
});
