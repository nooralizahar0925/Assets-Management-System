import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderPage } from "../test/render";
import AppSidebar from "../layout/AppSidebar";
import { SidebarProvider } from "./SidebarContext";

/**
 * The interface stops offering what the organisation has not bought.
 *
 * Courtesy, not enforcement: the API refuses these regardless, and there is a
 * test on that side for every one. But a menu full of items that answer "not
 * included in this plan" makes a product feel broken rather than tiered.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });

function mockSession(features: string[] | undefined) {
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = String(input);
    if (url.includes("/auth/me")) {
      return Promise.resolve(json({
        org_id: "org-1",
        ...(features === undefined ? {} : { features }),
        user: {
          id: "me", name: "Tester",
          permissions: ["assets:read", "reports:read", "stocktake:read"],
          location_scope: null, scopes: [],
        },
      }));
    }
    return Promise.resolve(json({ data: [] }));
  });
}

const render = () =>
  renderPage(
    <SidebarProvider><AppSidebar /></SidebarProvider>,
    { route: "/assets" },
  );

beforeEach(() => vi.restoreAllMocks());

describe("the sidebar against a plan", () => {
  it("shows what the plan includes", async () => {
    mockSession(["core", "import", "stocktake", "reports"]);
    render();

    await waitFor(() => expect(screen.getByText("Stock-takes")).toBeInTheDocument());
    expect(screen.getByText("Reports")).toBeInTheDocument();
    expect(screen.getByText("Import")).toBeInTheDocument();
  });

  it("leaves out what it does not", async () => {
    mockSession(["core", "import"]);
    render();

    await waitFor(() => expect(screen.getByText("Import")).toBeInTheDocument());
    expect(screen.queryByText("Stock-takes")).not.toBeInTheDocument();
    expect(screen.queryByText("Maintenance")).not.toBeInTheDocument();
  });

  it("never hides the register itself", async () => {
    mockSession(["core"]);
    render();
    // getAll: the sidebar renders its labels twice, once for the expanded
    // state and once for the collapsed one.
    await waitFor(() =>
      expect(screen.getAllByText("Assets").length).toBeGreaterThan(0));
    expect(screen.getAllByText("Dashboard").length).toBeGreaterThan(0);
  });

  it("shows everything when the API did not say", async () => {
    // A version behind during a rolling deploy. Allowing is the kinder
    // failure: the worst case is a menu item that leads to an explanation,
    // rather than half the product silently disappearing.
    mockSession(undefined);
    render();

    await waitFor(() =>
      expect(screen.getAllByText("Assets").length).toBeGreaterThan(0));
    expect(screen.getAllByText("Stock-takes").length).toBeGreaterThan(0);
  });
});
