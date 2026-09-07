import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AppWrapper } from "../../components/common/PageMeta";
import { groupByTag, type OpenApiDocument } from "../../api/developers";
import Reference from "./Reference";

vi.mock("../../api/developers", async () => {
  const actual = await vi.importActual<typeof import("../../api/developers")>(
    "../../api/developers",
  );
  // Partial: groupByTag is the logic under test, not a thing to stub out.
  return { ...actual, developersApi: { openapi: vi.fn(), errors: vi.fn() } };
});

const { developersApi } = await import("../../api/developers");

const DOC: OpenApiDocument = {
  openapi: "3.1.0",
  info: { title: "AMS", version: "1.0.0", description: "The register" },
  servers: [{ url: "https://your-host", description: "Your deployment" }],
  tags: [
    { name: "Assets", description: "The register itself" },
    { name: "Reports", description: "Running and downloading reports" },
    { name: "Unused", description: "Declared but never applied" },
  ],
  paths: {
    "/api/v1/assets": {
      get: {
        operationId: "listAssets", summary: "List assets", tags: ["Assets"],
        parameters: [{ name: "page", in: "query", description: "Page number" }],
        responses: { 200: { description: "A page of assets" } },
      },
      post: {
        operationId: "createAsset", summary: "Create an asset", tags: ["Assets"],
        responses: { 201: { description: "The new asset" } },
      },
    },
    "/api/v1/reports/{key}": {
      get: {
        operationId: "runReport", summary: "Run a report", tags: ["Reports"],
        responses: { 200: { description: "The report" } },
      },
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(developersApi.openapi).mockResolvedValue(DOC);
});

function renderReference() {
  return render(
    <AppWrapper>
      <MemoryRouter><Reference /></MemoryRouter>
    </AppWrapper>,
  );
}

describe("groupByTag", () => {
  it("keeps every operation, grouped under its tag", () => {
    const groups = groupByTag(DOC);
    expect(groups.map((g) => g.name)).toEqual(["Assets", "Reports"]);
    expect(groups[0].operations.map((o) => o.operationId))
      .toEqual(["listAssets", "createAsset"]);
  });

  it("drops a tag no operation uses rather than rendering an empty heading", () => {
    expect(groupByTag(DOC).some((g) => g.name === "Unused")).toBe(false);
  });

  it("keeps an operation whose tag was never declared", () => {
    // Otherwise a typo in a tag name silently deletes an endpoint from the
    // published reference - the worst possible failure for a contract.
    const groups = groupByTag({
      ...DOC,
      paths: { "/api/v1/odd": { get: {
        operationId: "odd", summary: "Odd one out", tags: ["Nowhere"],
        responses: {},
      } } },
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("Other");
    expect(groups[0].operations[0].operationId).toBe("odd");
  });

  it("orders methods as a reader expects, not alphabetically", () => {
    // Alphabetical would put delete before get.
    const groups = groupByTag({
      ...DOC,
      paths: { "/x": {
        delete: { operationId: "d", summary: "d", tags: ["Assets"], responses: {} },
        get: { operationId: "g", summary: "g", tags: ["Assets"], responses: {} },
      } },
    });
    expect(groups[0].operations.map((o) => o.operationId)).toEqual(["g", "d"]);
  });
});

describe("the API reference", () => {
  it("renders the live document rather than a transcription", async () => {
    renderReference();
    await waitFor(() => expect(developersApi.openapi).toHaveBeenCalled());
    expect(await screen.findByText("List assets")).toBeInTheDocument();
    expect(screen.getByText("Run a report")).toBeInTheDocument();
  });

  it("shows the method and path of each operation", async () => {
    renderReference();
    // Two operations share the path, so this is deliberately getAll.
    expect((await screen.findAllByText("/api/v1/assets")).length).toBe(2);
    // Lowercase in the DOM, uppercased by CSS - asserting on "GET" would pass
    // only by accident of styling.
    expect(screen.getAllByText("get").length).toBeGreaterThan(0);
  });

  it("reports the version of the contract being read", async () => {
    renderReference();
    expect(await screen.findByText(/1\.0\.0/)).toBeInTheDocument();
  });

  it("expands an operation to show its parameters and responses", async () => {
    renderReference();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /List assets/ }));
    expect(await screen.findByText("A page of assets")).toBeInTheDocument();
    expect(screen.getByText("page")).toBeInTheDocument();
  });

  it("links to the raw document, which is what a generator consumes", async () => {
    renderReference();
    expect(await screen.findByRole("link", { name: /openapi\.json/i }))
      .toHaveAttribute("href", expect.stringContaining("/api/v1/openapi.json"));
  });

  it("says so plainly when the document cannot be read", async () => {
    vi.mocked(developersApi.openapi).mockRejectedValue(new Error("offline"));
    renderReference();
    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
  });
});
