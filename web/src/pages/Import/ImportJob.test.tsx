import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderPage } from "../../test/render";
import ImportJob from "./ImportJob";

vi.mock("../../api/imports", () => ({
  importsApi: { job: vi.fn(), inspect: vi.fn(), run: vi.fn() },
}));

const { importsApi } = await import("../../api/imports");

const JOB = {
  id: "j1",
  filename: "assets-march.csv",
  status: "completed",
  dry_run: false,
  total: 120,
  created: 115,
  updated: 3,
  errors: [{ row: 7, field: "purchase_cost", message: "must not be negative" }],
  created_at: "2026-09-01T09:00:00Z",
};

const render_ = () => renderPage(<ImportJob />, {
  route: "/import/j1", path: "/import/:id",
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(importsApi.job).mockResolvedValue(JOB);
});

describe("the import result page", () => {
  it("is what the import-completed email links to", async () => {
    // The email has carried this link since the notification work; until this
    // page existed it landed the reader on the not-found page.
    render_();
    expect(await screen.findByText("assets-march.csv")).toBeInTheDocument();
    expect(importsApi.job).toHaveBeenCalledWith("j1");
  });

  it("shows what the import actually did", async () => {
    render_();
    expect(await screen.findByText("115")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
  });

  it("names the rows that were rejected and why", async () => {
    // A count of failures with no detail leaves the reader to find them by
    // hand in a hundred-row spreadsheet.
    render_();
    expect(await screen.findByText(/Row 7/)).toBeInTheDocument();
    expect(screen.getByText(/must not be negative/)).toBeInTheDocument();
  });

  it("says plainly when a run was only a preview", async () => {
    vi.mocked(importsApi.job).mockResolvedValue({ ...JOB, dry_run: true });
    render_();
    expect(await screen.findByText(/nothing was written/i)).toBeInTheDocument();
  });

  it("does not claim a preview wrote anything", async () => {
    vi.mocked(importsApi.job).mockResolvedValue({ ...JOB, dry_run: true });
    render_();
    expect(await screen.findByText("Preview only")).toBeInTheDocument();
  });

  it("says so when the import cannot be found", async () => {
    vi.mocked(importsApi.job).mockRejectedValue(new Error("404"));
    render_();
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be found/i);
  });
});
