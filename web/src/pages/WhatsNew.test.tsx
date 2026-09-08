import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderPage } from "../test/render";
import WhatsNew from "./WhatsNew";
import { releasesApi } from "../api/releases";

vi.mock("../api/releases", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/releases")>();
  return {
    ...actual,
    releasesApi: {
      list: vi.fn(), version: vi.fn(), markSeen: vi.fn(), unseen: vi.fn(),
    },
  };
});

const RELEASES = [
  {
    version: "1.2.0", title: "Scanning and labels", released_at: "2026-09-01",
    entries: [
      { type: "feature" as const, summary: "Scan a QR code to open an asset instantly." },
      { type: "fix" as const, summary: "Overdue reminders no longer send twice in a day." },
    ],
  },
  {
    version: "1.1.0", title: "Reporting", released_at: "2026-08-15",
    entries: [{ type: "improvement" as const, summary: "Reports now export to PDF." }],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(releasesApi.list).mockResolvedValue(RELEASES);
  vi.mocked(releasesApi.markSeen).mockResolvedValue(null as never);
  vi.mocked(releasesApi.version).mockResolvedValue({
    version: "1.2.0", git_sha: "3f9a1c2",
    built_at: "2026-09-01T02:00:00Z", migration: "019_releases.sql",
  });
});

const setup = () => renderPage(<WhatsNew />, { route: "/whats-new" });

describe("WhatsNew", () => {
  it("lists releases newest first", async () => {
    setup();
    await waitFor(() =>
      expect(screen.getByText("Scanning and labels")).toBeInTheDocument());

    // Releases are h3: the page title is the h2 the breadcrumb renders.
    const headings = screen.getAllByRole("heading", { level: 3 });
    expect(headings[0]).toHaveTextContent("Scanning and labels");
    expect(headings[1]).toHaveTextContent("Reporting");
  });

  it("shows the version and date for each release", async () => {
    setup();
    await waitFor(() => expect(screen.getByText("1.2.0")).toBeInTheDocument());
    expect(screen.getByText(/1 Sept? 2026/)).toBeInTheDocument();
  });

  it("renders every entry with what kind of change it was", async () => {
    setup();
    await waitFor(() =>
      expect(screen.getByText(/Scan a QR code/)).toBeInTheDocument());
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("Fixed")).toBeInTheDocument();
  });

  it("marks the newest version as read once the page is opened", async () => {
    // This is what clears the indicator in the sidebar: opening the page is
    // the act of reading them.
    setup();
    await waitFor(() =>
      expect(releasesApi.markSeen).toHaveBeenCalledWith("1.2.0"));
  });

  it("marks only the newest, since everything below it is older", async () => {
    setup();
    await waitFor(() => expect(releasesApi.markSeen).toHaveBeenCalled());
    expect(releasesApi.markSeen).toHaveBeenCalledTimes(1);
  });

  it("says which build this is, for a support conversation", async () => {
    setup();
    await waitFor(() => expect(screen.getByText(/3f9a1c2/)).toBeInTheDocument());
  });

  it("shows an empty state when nothing has been published", async () => {
    vi.mocked(releasesApi.list).mockResolvedValue([]);
    setup();
    await waitFor(() =>
      expect(screen.getByText(/No release notes yet/i)).toBeInTheDocument());
  });

  it("does not crash when the endpoint is unavailable", async () => {
    // A changelog is not worth an error screen: the rest of the product works.
    vi.mocked(releasesApi.list).mockRejectedValue(new Error("offline"));
    setup();
    await waitFor(() =>
      expect(screen.getByText(/No release notes yet/i)).toBeInTheDocument());
  });

  it("does not mark anything read when there is nothing to read", async () => {
    vi.mocked(releasesApi.list).mockResolvedValue([]);
    setup();
    await waitFor(() =>
      expect(screen.getByText(/No release notes yet/i)).toBeInTheDocument());
    expect(releasesApi.markSeen).not.toHaveBeenCalled();
  });
});
