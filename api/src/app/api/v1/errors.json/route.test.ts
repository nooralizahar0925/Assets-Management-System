import { describe, it, expect } from "vitest";
import { GET } from "./route";
import { problem } from "@/lib/http/problem";

interface Entry {
  slug: string; status: number; title: string;
  when: string; fix: string; type: string;
}

const read = async () =>
  ((await (await GET(new Request("http://api.test/api/v1/errors.json"))).json()) as
    { data: Entry[] }).data;

describe("GET /api/v1/errors.json", () => {
  it("serves the catalogue without a credential", async () => {
    // Somebody debugging a 401 cannot be asked to authenticate to read about it.
    const res = await GET(new Request("http://api.test/api/v1/errors.json"));
    expect(res.status).toBe(200);
    expect((await read()).length).toBeGreaterThan(5);
  });

  it("carries the absolute type URI a problem document actually contains", async () => {
    // The reader has a `type` string in front of them; it has to match.
    const conflict = (await read()).find((e) => e.slug === "conflict")!;
    const body = (await problem(409, "conflict", "Conflict").json()) as { type: string };
    expect(conflict.type).toBe(body.type);
  });

  it("says when each error fires and what to do about it", async () => {
    for (const entry of await read()) {
      expect(entry.when, entry.slug).toBeTruthy();
      expect(entry.fix, entry.slug).toBeTruthy();
    }
  });
});
