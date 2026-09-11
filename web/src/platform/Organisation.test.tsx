import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router";
import { AppWrapper } from "../components/common/PageMeta";
import Organisation from "./Organisation";

vi.mock("../api/platform", () => ({
  platformApi: {
    organisation: vi.fn(), plans: vi.fn(), updateOrganisation: vi.fn(),
    setEntitlements: vi.fn(), suspend: vi.fn(), resume: vi.fn(), remove: vi.fn(),
  },
}));

const { platformApi } = await import("../api/platform");
const { ApiError } = await import("../api/client");

const DETAIL = {
  id: "o1", name: "Acme Ltd", slug: "acme",
  plan_code: "professional", price_minor: 950_000, notes: "Rings on Tuesdays.",
  suspended_at: null, contract_starts: "2026-01-01",
  renews_on: "2027-01-01", trial_ends_at: null,
  limit_overrides: {}, created_at: "2026-01-01T00:00:00Z",
  entitlements: {
    features: ["core", "import", "reports", "stocktake", "webhooks"],
    limits: { max_assets: 5000, max_users: 50 },
    plan_code: "professional",
  },
  usage: { assets: 1284, users: 12, pending_invitations: 2, storage_mb: 340 },
  overrides: [
    { feature_key: "webhooks", enabled: true, note: "Agreed in the demo", set_at: "2026-06-01T00:00:00Z" },
  ],
};

import type { Plan, Feature } from "../api/platform";

const PLANS: { data: Plan[]; features: Feature[] } = {
  data: [
    {
      code: "professional", name: "Professional", description: "",
      price_minor: 950_000, currency: "IDR", billing_cycle: "monthly",
      features: ["core", "import", "reports", "stocktake"],
      limits: { max_assets: 5000, max_users: 50 }, active: true, sort_order: 2,
    },
    {
      code: "starter", name: "Starter", description: "",
      price_minor: 250_000, currency: "IDR", billing_cycle: "monthly",
      features: ["core"], limits: { max_assets: 500 }, active: true, sort_order: 1,
    },
  ],
  features: [
    { key: "core", group: "Core", label: "Asset register", description: "x" },
    { key: "stocktake", group: "Operations", label: "Stock-takes", description: "x" },
    { key: "webhooks", group: "Integration", label: "Webhooks", description: "x" },
    { key: "maintenance", group: "Operations", label: "Maintenance schedules", description: "x" },
  ],
};

const renderPage = () =>
  render(
    <AppWrapper>
      <MemoryRouter initialEntries={["/platform/o1"]}>
        <Routes>
          <Route path="/platform/:id" element={<Organisation />} />
          <Route path="/platform" element={<p>The customer list</p>} />
        </Routes>
      </MemoryRouter>
    </AppWrapper>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(platformApi.organisation).mockResolvedValue(DETAIL);
  vi.mocked(platformApi.plans).mockResolvedValue(PLANS);
  vi.mocked(platformApi.updateOrganisation).mockResolvedValue({
    slug: "acme", entitlements: DETAIL.entitlements,
  });
  vi.mocked(platformApi.setEntitlements).mockResolvedValue(DETAIL.entitlements);
});

describe("one customer's page", () => {
  it("shows where each feature comes from", async () => {
    // "From the Professional plan" and "Turned on for this customer" are
    // different facts, and the operator needs to know which they are changing.
    renderPage();
    // getAll: several features legitimately come from the same plan, and the
    // point is that each one says where it came from - not that only one does.
    expect((await screen.findAllByText(/from the Professional/i)).length)
      .toBeGreaterThan(0);
    expect(screen.getByText(/turned on for this customer/i)).toBeInTheDocument();
  });

  it("says which exception was made, and why", async () => {
    renderPage();
    expect(await screen.findByText(/Agreed in the demo/)).toBeInTheDocument();
  });

  it("marks a feature the plan does not include", async () => {
    renderPage();
    expect(await screen.findByText(/not in their plan/i)).toBeInTheDocument();
  });

  it("shows usage against each limit", async () => {
    renderPage();
    expect(await screen.findByText("1,284 of 5,000")).toBeInTheDocument();
  });

  it("counts a pending invitation against the people limit", async () => {
    // It holds a seat. Twelve people and two invitations is fourteen against
    // the cap, which is what the API enforces.
    renderPage();
    expect(await screen.findByText("14 of 50")).toBeInTheDocument();
  });

  it("will not let the register itself be switched off", async () => {
    renderPage();
    const registerSwitch = await screen.findByRole("switch", { name: "Asset register" });
    expect(registerSwitch).toBeDisabled();
  });

  it("turns a feature on by sending the whole set of exceptions", async () => {
    // The endpoint replaces rather than merges, and only the console knows
    // what the operator meant to leave alone.
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("switch", { name: "Maintenance schedules" }));

    await waitFor(() => expect(platformApi.setEntitlements).toHaveBeenCalledWith("o1", [
      { feature_key: "webhooks", enabled: true, note: "Agreed in the demo", set_at: "2026-06-01T00:00:00Z" },
      { feature_key: "maintenance", enabled: true, note: "" },
    ]));
  });

  it("drops an exception that agrees with the plan rather than keeping noise", async () => {
    // Turning off a feature that the plan does not grant anyway should leave
    // nothing behind implying somebody decided something.
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("switch", { name: "Webhooks" }));

    await waitFor(() => expect(platformApi.setEntitlements)
      .toHaveBeenCalledWith("o1", []));
  });

  it("moves a customer to another plan", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(await screen.findByLabelText(/^plan$/i), "starter");
    await waitFor(() => expect(platformApi.updateOrganisation)
      .toHaveBeenCalledWith("o1", { plan_code: "starter" }));
  });

  it("saves notes when the operator leaves the field", async () => {
    const user = userEvent.setup();
    renderPage();

    const notes = await screen.findByLabelText(/notes/i);
    await user.clear(notes);
    await user.type(notes, "Moving to yearly billing.");
    await user.tab();

    await waitFor(() => expect(platformApi.updateOrganisation)
      .toHaveBeenCalledWith("o1", { notes: "Moving to yearly billing." }));
  });

  it("asks for a reason before suspending", async () => {
    // It goes in the record, and somebody will want it months from now.
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("Unpaid since March");
    vi.mocked(platformApi.suspend).mockResolvedValue(null);

    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: /suspend access/i }));

    expect(prompt).toHaveBeenCalled();
    await waitFor(() => expect(platformApi.suspend)
      .toHaveBeenCalledWith("o1", "Unpaid since March"));
  });

  it("does not suspend when the reason is left blank", async () => {
    vi.spyOn(window, "prompt").mockReturnValue("");
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: /suspend access/i }));
    expect(platformApi.suspend).not.toHaveBeenCalled();
  });

  it("offers to restore access to a suspended customer", async () => {
    vi.mocked(platformApi.organisation).mockResolvedValue({
      ...DETAIL, suspended_at: "2026-08-01T00:00:00Z",
    });
    renderPage();

    expect(await screen.findByRole("button", { name: /restore access/i }))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /suspend access/i }))
      .not.toBeInTheDocument();
  });

  it("will not delete without the slug typed exactly", async () => {
    const user = userEvent.setup();
    renderPage();

    const remove = await screen.findByRole("button", { name: /remove permanently/i });
    expect(remove).toBeDisabled();

    await user.type(screen.getByLabelText(/type the slug/i), "acme-wrong");
    expect(remove).toBeDisabled();

    await user.clear(screen.getByLabelText(/type the slug/i));
    await user.type(screen.getByLabelText(/type the slug/i), "acme");
    expect(remove).toBeEnabled();
  });

  it("returns to the list once a customer is removed", async () => {
    vi.mocked(platformApi.remove).mockResolvedValue(null);
    const user = userEvent.setup();
    renderPage();

    await user.type(await screen.findByLabelText(/type the slug/i), "acme");
    await user.click(screen.getByRole("button", { name: /remove permanently/i }));

    expect(await screen.findByText("The customer list")).toBeInTheDocument();
  });

  it("says what the server refused, rather than failing quietly", async () => {
    vi.mocked(platformApi.updateOrganisation).mockRejectedValue(new ApiError(422, {
      type: "validation", status: 422, title: "Validation failed",
      detail: "That plan does not exist.",
    }));

    const user = userEvent.setup();
    renderPage();
    await user.selectOptions(await screen.findByLabelText(/^plan$/i), "starter");

    expect(await screen.findByRole("alert"))
      .toHaveTextContent(/that plan does not exist/i);
  });
});

describe("a customer over their limit", () => {
  it("says so plainly rather than only showing two numbers", async () => {
    vi.mocked(platformApi.organisation).mockResolvedValue({
      ...DETAIL,
      entitlements: { ...DETAIL.entitlements, limits: { max_assets: 500 } },
    });
    renderPage();

    const limits = await screen.findByText(/over their limit/i);
    expect(limits).toBeInTheDocument();
  });
});

describe("a customer with no limits at all", () => {
  it("says so rather than showing an empty list", async () => {
    vi.mocked(platformApi.organisation).mockResolvedValue({
      ...DETAIL,
      plan_code: null, limit_overrides: {},
      entitlements: { features: ["core"], limits: {}, plan_code: null },
    });
    renderPage();

    expect(await screen.findByText(/can hold as much as they like/i))
      .toBeInTheDocument();
  });
});
