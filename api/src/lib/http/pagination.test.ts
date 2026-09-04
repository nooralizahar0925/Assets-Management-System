import { describe, it, expect } from "vitest";
import { parsePagination, parseSort } from "./pagination";

const url = (qs: string) => new URL(`http://x/api/v1/assets${qs}`);

describe("parsePagination", () => {
  it("defaults to page 1, 50 per page", () => {
    expect(parsePagination(url(""))).toEqual({ page: 1, perPage: 50, offset: 0 });
  });

  it("computes the offset", () => {
    expect(parsePagination(url("?page=3&per_page=20")).offset).toBe(40);
  });

  it("caps per_page at 200", () => {
    expect(parsePagination(url("?per_page=5000")).perPage).toBe(200);
  });

  it("rejects nonsense values by falling back to the default", () => {
    expect(parsePagination(url("?page=-4&per_page=abc"))).toEqual({
      page: 1, perPage: 50, offset: 0,
    });
  });
});

describe("parseSort", () => {
  const allowed = ["name", "created_at"] as const;

  it("reads a descending sort from the leading dash", () => {
    expect(parseSort(url("?sort=-created_at"), allowed, "name")).toEqual({
      column: "created_at", direction: "DESC",
    });
  });

  it("ignores a column that is not allowlisted", () => {
    expect(parseSort(url("?sort=password_hash"), allowed, "name")).toEqual({
      column: "name", direction: "ASC",
    });
  });
});
