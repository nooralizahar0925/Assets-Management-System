import { describe, it, expect, vi, beforeEach } from "vitest";
import { inDays as iso } from "../../test/dates";
import { screen, waitFor } from "@testing-library/react";
import { renderPage } from "../../test/render";
import MaintenanceList from "./MaintenanceList";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });

const SCHEDULES = [
  {
    id: "m1", asset_id: "a1", asset_name: "Forklift 8FG25",
    description: "Annual service", every_days: 365, every_hours: null,
    next_due_at: iso(-10), next_due_hours: null, current_hours: null,
    last_service_at: iso(-375), active: true,
  },
  {
    id: "m2", asset_id: "a2", asset_name: "Delivery van",
    description: "Quarterly", every_days: 90, every_hours: null,
    next_due_at: iso(30), next_due_hours: null, current_hours: null,
    last_service_at: null, active: true,
  },
  {
    id: "m3", asset_id: "a3", asset_name: "Generator",
    description: "500-hour service", every_days: null, every_hours: 500,
    next_due_at: null, next_due_hours: 1500, current_hours: 1620,
    last_service_at: null, active: true,
  },
  {
    id: "m4", asset_id: "a4", asset_name: "Retired compressor",
    description: "Switched off", every_days: 30, every_hours: null,
    next_due_at: iso(-99), next_due_hours: null, current_hours: null,
    last_service_at: null, active: false,
  },
];

function mockSession(permissions: string[]) {
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = String(input);
    if (url.includes("/auth/me")) {
      return Promise.resolve(json({
        org_id: "org-1",
        user: {
          id: "u1", name: "Rina", permissions,
          location_scope: null, scopes: [],
        },
      }));
    }
    if (url.includes("/maintenance/schedules")) {
      return Promise.resolve(json({ data: SCHEDULES }));
    }
    return Promise.resolve(json({ data: [] }));
  });
}

const render = () => renderPage(<MaintenanceList />, { route: "/maintenance" });

beforeEach(() => vi.restoreAllMocks());

describe("MaintenanceList", () => {
  it("puts what is overdue first, where it will be seen", async () => {
    mockSession(["maintenance:read"]);
    render();
    await waitFor(() => expect(screen.getByText(/Overdue \(2\)/)).toBeInTheDocument());
  });

  it("counts an hour schedule as overdue once the meter passes it", async () => {
    // A generator past 1,500 hours is overdue even though it has no date.
    mockSession(["maintenance:read"]);
    render();
    await waitFor(() => expect(screen.getByText("Generator")).toBeInTheDocument());
    expect(screen.getByText(/1500 hours \(now 1620\)/)).toBeInTheDocument();
  });

  it("says how late something is, not just that it is late", async () => {
    mockSession(["maintenance:read"]);
    render();
    await waitFor(() => expect(screen.getByText(/10 days overdue/)).toBeInTheDocument());
  });

  it("leaves work that is not due yet under coming up", async () => {
    mockSession(["maintenance:read"]);
    render();
    await waitFor(() => expect(screen.getByText("Delivery van")).toBeInTheDocument());
    expect(screen.getByText(/In 30 days/)).toBeInTheDocument();
  });

  it("ignores a schedule that has been switched off", async () => {
    // Otherwise a decommissioned machine sits at the top of the overdue list
    // forever.
    mockSession(["maintenance:read"]);
    render();
    await waitFor(() => expect(screen.getByText("Forklift 8FG25")).toBeInTheDocument());
    expect(screen.queryByText("Retired compressor")).not.toBeInTheDocument();
  });

  it("turns away someone whose role does not cover maintenance", async () => {
    mockSession(["assets:read"]);
    render();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/does not include service/i));
  });
});
