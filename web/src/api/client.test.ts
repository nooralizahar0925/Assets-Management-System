import { describe, it, expect, vi, beforeEach } from "vitest";
import { api, ApiError } from "./client";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  vi.restoreAllMocks();
  import.meta.env.VITE_API_BASE_URL = "http://api.test";
});

describe("api.get", () => {
  it("calls the configured base url and unwraps the envelope", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValue(json({ data: [{ id: "1" }] }));
    await expect(api.get("/api/v1/assets")).resolves.toEqual([{ id: "1" }]);
    expect(fetchMock.mock.calls[0][0]).toBe("http://api.test/api/v1/assets");
  });

  it("sends cookies so the session travels cross-origin", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ data: [] }));
    await api.get("/api/v1/assets");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "include" });
  });

  it("serialises params, dropping empty values", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ data: [] }));
    await api.get("/api/v1/assets", { q: "dell", status: "", page: 2 });
    expect(fetchMock.mock.calls[0][0]).toBe("http://api.test/api/v1/assets?q=dell&page=2");
  });

  it("repeats an array param rather than joining it", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ data: [] }));
    await api.get("/api/v1/assets", { status: ["available", "in_use"] });
    expect(fetchMock.mock.calls[0][0])
      .toBe("http://api.test/api/v1/assets?status=available&status=in_use");
  });

  it("returns the raw body when there is no data envelope", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ id: "1", name: "Laptop" }));
    await expect(api.get("/api/v1/assets/1")).resolves.toEqual({ id: "1", name: "Laptop" });
  });
});

describe("error handling", () => {
  it("throws an ApiError carrying the problem document", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({
      type: "https://ams.dev/errors/not-found", title: "Asset not found", status: 404,
    }, 404));
    await expect(api.get("/api/v1/assets/x")).rejects.toMatchObject({
      status: 404, message: "Asset not found",
    });
  });

  it("indexes validation errors by field for form display", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({
      type: "https://ams.dev/errors/validation", title: "Validation failed", status: 422,
      errors: [{ field: "serial_no", message: "already exists" }],
    }, 422));
    try {
      await api.post("/api/v1/assets", { name: "x" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).fieldErrors).toEqual({ serial_no: "already exists" });
    }
  });

  it("reports a network failure as a readable message", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(api.get("/api/v1/assets")).rejects.toThrow(/could not reach/i);
  });
});

describe("api.post and api.del", () => {
  it("sends JSON with the right content type", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ id: "1" }, 201));
    await api.post("/api/v1/assets", { name: "Laptop" });
    const init = fetchMock.mock.calls[0][1]!;
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ name: "Laptop" }));
  });

  it("tolerates a 204 with no body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.del("/api/v1/assets/1")).resolves.toBeNull();
  });
});
