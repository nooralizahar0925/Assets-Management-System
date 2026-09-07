import { describe, it, expect } from "vitest";
import { GET as VERSION } from "./route";
import { GET as RELEASES } from "../releases/route";

describe("GET /api/version", () => {
  it("answers without a credential, because a monitor has none", async () => {
    const res = await VERSION(new Request("http://api.test/api/version"));
    expect(res.status).toBe(200);

    const body = (await res.json()) as { version: string; migration: string };
    expect(body.version).toBeTruthy();
    expect(body.migration).toMatch(/\.sql$/);
  });

  it("is never cached, so a deploy is visible immediately", async () => {
    // Caching this would mean a support conversation reading a stale build.
    const res = await VERSION(new Request("http://api.test/api/version"));
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("GET /api/releases", () => {
  it("serves the changelog without a credential", async () => {
    const res = await RELEASES(new Request("http://api.test/api/releases"));
    expect(res.status).toBe(200);
    expect((await res.json()) as { data: unknown[] }).toHaveProperty("data");
  });
});
