import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderPage } from "../../test/render";
import ImportWizard from "./ImportWizard";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });

function mockSession(permissions: string[], locationScope: string[] | null) {
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = String(input);
    if (url.includes("/auth/me")) {
      return Promise.resolve(json({
        org_id: "org-1",
        user: {
          id: "u1", name: "Tester", permissions,
          location_scope: locationScope, scopes: [],
        },
      }));
    }
    return Promise.resolve(json({ data: [] }));
  });
}

const render = () => renderPage(<ImportWizard />, { route: "/import" });

beforeEach(() => vi.restoreAllMocks());

describe("ImportWizard access", () => {
  it("opens the wizard for an organisation-wide importer", async () => {
    mockSession(["assets:import", "assets:write"], null);
    render();
    await waitFor(() =>
      expect(screen.getByText(/Drag a spreadsheet here/i)).toBeInTheDocument());
  });

  it("turns away someone whose role does not include importing", async () => {
    mockSession(["assets:write"], null);
    render();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/does not include importing/i));
    expect(screen.queryByText(/Drag a spreadsheet here/i)).not.toBeInTheDocument();
  });

  it("explains why a branch-scoped account cannot import", async () => {
    // The API refuses this outright, because an imported asset has no location
    // and would be invisible to the person who imported it. Saying so up front
    // beats a 403 after they have prepared a spreadsheet.
    mockSession(["assets:import"], ["loc-bekasi"]);
    render();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/limited to specific branches/i));
    expect(screen.queryByText(/Drag a spreadsheet here/i)).not.toBeInTheDocument();
  });
});
