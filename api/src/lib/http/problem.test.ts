import { describe, it, expect } from "vitest";
import { z } from "zod";
import { problem, validationProblem, notFound } from "./problem";

describe("problem responses", () => {
  it("uses the problem+json content type", async () => {
    const res = problem(403, "forbidden", "Forbidden");
    expect(res.status).toBe(403);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
    await expect(res.json()).resolves.toMatchObject({
      type: "https://ams.dev/errors/forbidden",
      title: "Forbidden",
      status: 403,
    });
  });

  it("maps zod issues to a field error list", async () => {
    const schema = z.object({ name: z.string().min(1) });
    const parsed = schema.safeParse({ name: "" });
    const res = validationProblem(parsed.error!);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { errors: unknown };
    expect(body.errors).toEqual([
      { field: "name", message: expect.any(String) },
    ]);
  });

  it("reports the missing resource by name", async () => {
    const body = (await notFound("asset").json()) as { title: string };
    expect(body.title).toBe("Asset not found");
  });
});
