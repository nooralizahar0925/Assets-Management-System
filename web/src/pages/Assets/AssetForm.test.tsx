import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderPage } from "../../test/render";
import AssetForm from "./AssetForm";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });

const CATEGORIES = [
  {
    id: "c1", name: "Laptops", kind: "it",
    field_schema: { fields: [] },
    depreciation_method: "straight_line", useful_life_months: 36,
    salvage_pct: "10.00", declining_rate_pct: null,
  },
];

const LOCATIONS = [
  { id: "loc-jakarta", name: "Jakarta", parent_id: null, address: null,
    depth: 0, path: "Jakarta", asset_count: 2 },
  { id: "loc-bekasi", name: "Bekasi", parent_id: null, address: null,
    depth: 0, path: "Bekasi", asset_count: 1 },
];

/** Answers /me with the given session, and the catalog calls the form makes. */
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
    if (url.includes("/locations")) return Promise.resolve(json({ data: LOCATIONS }));
    if (url.includes("/categories")) return Promise.resolve(json({ data: CATEGORIES }));
    return Promise.resolve(json({ data: [] }));
  });
}

const renderForm = () =>
  renderPage(<AssetForm mode="create" />, { route: "/assets/new" });

beforeEach(() => vi.restoreAllMocks());

describe("AssetForm permissions", () => {
  it("refuses the form to someone who cannot write, rather than at submit", async () => {
    // Letting a viewer fill in every field and fail on submit wastes their work
    // and tells them nothing until the end.
    mockSession(["assets:read"], null);
    renderForm();

    await waitFor(() =>
      expect(screen.getByText(/cannot change assets/i)).toBeInTheDocument());
    expect(screen.queryByLabelText(/^name/i)).not.toBeInTheDocument();
  });

  it("shows the form to someone who can write", async () => {
    mockSession(["assets:write"], null);
    renderForm();

    await waitFor(() =>
      expect(screen.getByLabelText(/^name/i)).toBeInTheDocument());
  });
});

describe("AssetForm branch scope", () => {
  it("offers every location to an unscoped user", async () => {
    mockSession(["assets:write"], null);
    renderForm();

    await waitFor(() => expect(screen.getByLabelText(/location/i)).toBeInTheDocument());
    expect(screen.getByRole("option", { name: "Jakarta" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Bekasi" })).toBeInTheDocument();
  });

  it("offers a scoped user only their own branches", async () => {
    // Picking a branch the API refuses is a dead end, and an asset filed
    // outside their scope is one they immediately lose sight of.
    mockSession(["assets:write"], ["loc-bekasi"]);
    renderForm();

    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Bekasi" })).toBeInTheDocument());
    expect(screen.queryByRole("option", { name: "Jakarta" })).not.toBeInTheDocument();
  });
});

describe("AssetForm depreciation", () => {
  it("shows what the category would give before any override", async () => {
    // Starting blank would look like the asset depreciates nothing, which is
    // not what its category says.
    mockSession(["assets:write"], null);
    renderForm();

    await waitFor(() =>
      expect(screen.getByLabelText(/^name/i)).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText(/category/i), "c1");

    expect(await screen.findByText(/straight line over 36 months/i))
      .toBeInTheDocument();
    expect(screen.getByText(/from its category/i)).toBeInTheDocument();
  });

  it("offers a service date separate from the purchase date", async () => {
    mockSession(["assets:write"], null);
    renderForm();
    await waitFor(() =>
      expect(screen.getByLabelText(/In service from/i)).toBeInTheDocument());
  });
});
