import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AppWrapper } from "../../components/common/PageMeta";
import type { OpenApiDocument } from "../../api/developers";
import Webhooks from "./Webhooks";

vi.mock("../../api/developers", async () => {
  const actual = await vi.importActual<typeof import("../../api/developers")>(
    "../../api/developers",
  );
  // webhookEventsIn is the logic under test, so only the transport is stubbed.
  return { ...actual, developersApi: { openapi: vi.fn(), errors: vi.fn() } };
});

const { developersApi } = await import("../../api/developers");

const docWith = (events: string[]) => ({
  openapi: "3.1.0",
  info: { title: "AMS", version: "1.0.0", description: "" },
  servers: [],
  tags: [],
  paths: {},
  components: {
    schemas: { WebhookInput: { properties: { events: { items: { enum: events } } } } },
  },
}) as OpenApiDocument;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(developersApi.openapi).mockResolvedValue(
    docWith(["asset.created", "import.completed"]),
  );
});

const renderPage = () => render(
  <AppWrapper><MemoryRouter><Webhooks /></MemoryRouter></AppWrapper>,
);

describe("the webhooks page", () => {
  it("lists the events the server actually accepts", async () => {
    renderPage();
    expect(await screen.findByText("asset.created")).toBeInTheDocument();
    // Also named in the prose about imports, hence getAll.
    expect(screen.getAllByText("import.completed").length).toBeGreaterThan(0);
  });

  it("shows an event it has no description for rather than hiding it", async () => {
    // Dropping the unknown one would make a newly published event invisible
    // here, which is exactly when the documentation matters most.
    vi.mocked(developersApi.openapi).mockResolvedValue(docWith(["asset.exploded"]));
    renderPage();
    expect(await screen.findByText("asset.exploded")).toBeInTheDocument();
  });

  it("still documents the events when the server cannot be reached", async () => {
    vi.mocked(developersApi.openapi).mockRejectedValue(new Error("offline"));
    renderPage();
    expect(await screen.findByText("asset.checked_out")).toBeInTheDocument();
  });

  it("insists the signature is computed over the raw body", async () => {
    renderPage();
    await waitFor(() => expect(developersApi.openapi).toHaveBeenCalled());
    expect(screen.getByText(/raw request body/i)).toBeInTheDocument();
  });

  it("states the real retry schedule, not a vague promise of backoff", async () => {
    renderPage();
    expect(screen.getByText(/1, 5 and 30 minutes/)).toBeInTheDocument();
  });

  it("warns that an import does not fan out into per-asset deliveries", async () => {
    renderPage();
    expect(screen.getByText(/do not fan out/i)).toBeInTheDocument();
  });
});
