import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderPage } from "../../test/render";
import type { DashboardSummary } from "../../api/types";
import Home from "./Home";

vi.mock("../../api/dashboard", () => ({
  dashboardApi: { summary: vi.fn() },
}));

const canMock = vi.fn((_permission: string) => true);
vi.mock("../../context/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("../../context/AuthContext")>(
    "../../context/AuthContext",
  );
  return { ...actual, useAuth: () => ({ can: canMock, user: null }) };
});

// The charts are lazy and pull in ApexCharts; the tests below are about the
// onboarding path, so they are stubbed rather than loaded.
vi.mock("../../components/dashboard/StatusDonut", () => ({ default: () => null }));
vi.mock("../../components/dashboard/CategoryBars", () => ({ default: () => null }));

const { dashboardApi } = await import("../../api/dashboard");

const SUMMARY: DashboardSummary = {
  totals: {
    assets: 40, active_assignments: 3, overdue: 1, maintenance: 2,
    total_value: "100000000", book_value: "80000000", currency: "IDR",
  },
  by_status: [], by_category: [], by_location: [],
  recent_activity: [], expiring_soon: [],
  utilisation: { in_use_pct: 12 },
  setup: { categories: 2, users: 1, api_keys: 0, imports: 0, checkouts: 0 },
};

beforeEach(() => {
  vi.clearAllMocks();
  canMock.mockReturnValue(true);
  vi.mocked(dashboardApi.summary).mockResolvedValue(SUMMARY);
});

describe("the dashboard", () => {
  it("shows what is still to be set up, counted from the register", async () => {
    renderPage(<Home />);
    // categories and assets done; team, key and a check-out still to do.
    expect(await screen.findByText("2 of 5")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /invite your colleagues/i }))
      .toBeInTheDocument();
  });

  it("offers only the steps this person is allowed to take", async () => {
    canMock.mockImplementation((permission) => permission === "custody:write");
    renderPage(<Home />);
    await screen.findByText(/getting set up/i);
    expect(screen.queryByRole("link", { name: /invite your colleagues/i }))
      .not.toBeInTheDocument();
  });

  it("welcomes an empty register instead of showing six zeroes", async () => {
    vi.mocked(dashboardApi.summary).mockResolvedValue({
      ...SUMMARY,
      totals: { ...SUMMARY.totals, assets: 0 },
    });
    renderPage(<Home />);
    expect(await screen.findByText(/your register is empty/i)).toBeInTheDocument();
    expect(screen.queryByText(/getting set up/i)).not.toBeInTheDocument();
  });

  it("says so plainly when the dashboard cannot be loaded", async () => {
    vi.mocked(dashboardApi.summary).mockRejectedValue(new Error("offline"));
    renderPage(<Home />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not load/i);
  });
});
