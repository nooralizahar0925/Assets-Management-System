import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { useAssetQuery } from "./useAssetQuery";

const wrapper = (initial: string) =>
  ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>
  );

describe("useAssetQuery", () => {
  it("defaults to page 1 and no filters", () => {
    const { result } = renderHook(() => useAssetQuery(), { wrapper: wrapper("/assets") });
    expect(result.current.query).toMatchObject({ page: 1, q: "", status: [] });
  });

  it("reads filters out of the url", () => {
    const { result } = renderHook(() => useAssetQuery(), {
      wrapper: wrapper("/assets?q=dell&status=available&status=in_use&page=3"),
    });
    expect(result.current.query).toMatchObject({
      q: "dell", status: ["available", "in_use"], page: 3,
    });
  });

  it("resets to page 1 when a filter changes", () => {
    const { result } = renderHook(() => useAssetQuery(), {
      wrapper: wrapper("/assets?page=5"),
    });
    act(() => result.current.setFilter("q", "laptop"));
    expect(result.current.query.page).toBe(1);
  });

  it("keeps the page when only the page changes", () => {
    const { result } = renderHook(() => useAssetQuery(), {
      wrapper: wrapper("/assets?q=dell"),
    });
    act(() => result.current.setPage(4));
    expect(result.current.query).toMatchObject({ q: "dell", page: 4 });
  });

  it("toggles sort direction on the active column", () => {
    const { result } = renderHook(() => useAssetQuery(), {
      wrapper: wrapper("/assets?sort=name"),
    });
    act(() => result.current.setSort("-name"));
    expect(result.current.query.sort).toBe("-name");
  });

  it("clears every filter but keeps the sort", () => {
    const { result } = renderHook(() => useAssetQuery(), {
      wrapper: wrapper("/assets?q=x&status=lost&sort=-name"),
    });
    act(() => result.current.clear());
    expect(result.current.query).toMatchObject({ q: "", status: [], sort: "-name" });
  });
});
