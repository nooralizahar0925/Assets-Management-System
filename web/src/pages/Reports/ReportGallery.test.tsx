import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderPage } from "../../test/render";
import ReportGallery from "./ReportGallery";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });

const SCHEDULES = [
  {
    id: "s1", saved_report_id: "sr1", report_name: "Monthly register",
    format: "pdf", cadence: "monthly", day_of_week: null, day_of_month: 1,
    hour_utc: 8, recipients: ["ops@example.com"], active: true, last_run_at: null,
  },
];

function mockSession(permissions: string[]) {
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = String(input);
    if (url.includes("/auth/me")) {
      return Promise.resolve(json({
        org_id: "org-1",
        user: {
          id: "u1", name: "Tester", permissions,
          location_scope: null, scopes: [],
        },
      }));
    }
    if (url.includes("/report-schedules")) return Promise.resolve(json(SCHEDULES));
    if (url.includes("/saved-reports")) return Promise.resolve(json([]));
    if (url.includes("/reports")) {
      return Promise.resolve(json([
        {
          key: "assets-by-status", name: "Assets by status", description: "d",
          columns: [], chart: { type: "donut" }, formats: ["csv", "pdf"],
        },
      ]));
    }
    return Promise.resolve(json([]));
  });
}

const render = () => renderPage(<ReportGallery />, { route: "/reports" });

beforeEach(() => vi.restoreAllMocks());

describe("ReportGallery", () => {
  it("lists the reports available to run", async () => {
    mockSession(["reports:read"]);
    render();
    await waitFor(() =>
      expect(screen.getByText("Assets by status")).toBeInTheDocument());
  });

  it("shows scheduled deliveries to someone who may schedule", async () => {
    // The endpoint is guarded by reports:schedule. Gating this on the "admin"
    // API scope instead - which is not a permission at all - hides the section
    // from everyone, including the administrators it is meant for.
    mockSession(["reports:read", "reports:schedule"]);
    render();
    await waitFor(() =>
      expect(screen.getByText("Scheduled deliveries")).toBeInTheDocument());
    expect(screen.getByText("Monthly register")).toBeInTheDocument();
  });

  it("hides scheduled deliveries from someone who may not schedule", async () => {
    mockSession(["reports:read"]);
    render();
    await waitFor(() =>
      expect(screen.getByText("Assets by status")).toBeInTheDocument());
    expect(screen.queryByText("Scheduled deliveries")).not.toBeInTheDocument();
  });
});
