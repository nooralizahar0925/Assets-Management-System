import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AuthProvider } from "../../context/AuthContext";
import KpiTiles from "./KpiTiles";

const totals = {
  assets: 1284, active_assignments: 96, overdue: 4, maintenance: 12,
  total_value: "8450000000", book_value: "8450000000", currency: "IDR",
};

/** The /me probe AuthProvider makes on mount. */
const mockSession = (permissions: string[]) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({
      org_id: "org-1",
      user: {
        id: "u1", name: "Tester", permissions,
        location_scope: null, scopes: [],
      },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  );

const setup = (
  over: Partial<typeof totals> = {},
  permissions = ["assets:read", "reports:read"],
) => {
  mockSession(permissions);
  return render(
    <MemoryRouter>
      <AuthProvider>
        <KpiTiles totals={{ ...totals, ...over }} utilisation={{ in_use_pct: 42 }} />
      </AuthProvider>
    </MemoryRouter>,
  );
};

/** The tiles render before the session resolves; wait for it to settle. */
const ready = () =>
  waitFor(() => expect(screen.getByText("Total assets")).toBeInTheDocument());

beforeEach(() => vi.restoreAllMocks());

describe("KpiTiles", () => {
  it("shows the headline counts with thousands separators", async () => {
    setup();
    await ready();
    expect(screen.getByText("1,284")).toBeInTheDocument();
    expect(screen.getByText("96")).toBeInTheDocument();
  });

  it("formats total value as currency", async () => {
    setup();
    await ready();
    expect(screen.getByText(/8[.,]450[.,]000[.,]000|8,5 M|8\.5/)).toBeInTheDocument();
  });

  it("does not round hundreds of millions out of the register value", async () => {
    // Compact notation at zero fraction digits renders Rp 8,450,000,000 as
    // "Rp 8 M", losing 450 million from a figure people read as authoritative.
    setup();
    await ready();
    expect(screen.queryByText("Rp 8 M")).not.toBeInTheDocument();
    // The exact figure stays reachable on hover, since the tile itself rounds.
    const tile = screen.getByText("Register value").closest("[title]");
    expect(tile?.getAttribute("title")).toMatch(/8[.,]450[.,]000[.,]000/);
  });

  it("says nothing about writing down when nothing has depreciated", async () => {
    // Book value equals cost until a policy is set. Claiming it was "written
    // down to" the same figure would imply a policy that does not exist.
    setup();
    await ready();
    expect(screen.queryByText(/Written down/i)).not.toBeInTheDocument();
  });

  it("shows the written-down value once depreciation has reduced it", async () => {
    setup({ book_value: "6000000000" });
    await ready();
    expect(screen.getByText(/Written down to/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Register value/i }))
      .toHaveAttribute("href", "/reports/asset-book-value");
  });

  it("links each tile into a pre-filtered register", async () => {
    setup();
    await ready();
    expect(screen.getByRole("link", { name: /Total assets/i }))
      .toHaveAttribute("href", "/assets");
    expect(screen.getByRole("link", { name: /In maintenance/i }))
      .toHaveAttribute("href", "/assets?status=maintenance");
  });

  it("highlights overdue when there are any", async () => {
    const { container } = setup({ overdue: 4 });
    await ready();
    expect(container.innerHTML).toContain("error");
  });

  it("does not raise an alarm when nothing is overdue", async () => {
    setup({ overdue: 0 });
    await ready();
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("shows utilisation as a percentage", async () => {
    setup();
    await ready();
    expect(screen.getByText("42%")).toBeInTheDocument();
  });

  it("still shows report-backed numbers to someone who cannot open reports", async () => {
    // The count is useful on its own. A link to a report page they would be
    // refused is not, and there is no register filter for "overdue" to send
    // them to instead.
    setup({}, ["assets:read"]);
    await ready();
    expect(screen.getByText("Overdue")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Overdue/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Utilisation/i })).not.toBeInTheDocument();
  });

  it("keeps the register tiles clickable without reports access", async () => {
    setup({}, ["assets:read"]);
    await ready();
    expect(screen.getByRole("link", { name: /Total assets/i }))
      .toHaveAttribute("href", "/assets");
  });
});
