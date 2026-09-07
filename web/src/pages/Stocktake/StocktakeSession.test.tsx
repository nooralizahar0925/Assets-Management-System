import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderPage } from "../../test/render";
import StocktakeSession from "./StocktakeSession";
import type { CountOutcome } from "../../api/stocktake";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });

const SESSION = {
  id: "s1", location_id: "loc-1", location_name: "Warehouse",
  name: "Q1 count", status: "open" as const,
  opened_at: "2026-04-01T08:00:00Z", closed_at: null,
  expected_ids: ["a1", "a2", "a3"], counted: 1,
};

const RECONCILIATION = {
  expected: 3,
  counted: 1,
  missing: [
    { id: "a2", name: "Forklift B", asset_tag: "AMS-000002" },
    { id: "a3", name: "Pallet truck", asset_tag: "AMS-000003" },
  ],
  unexpected: [] as { id: string; name: string; asset_tag: string }[],
};

/** The next scan's answer, so a test can choose what the tag turns out to be. */
let nextOutcome: { outcome: CountOutcome; asset?: unknown } = {
  outcome: "expected",
  asset: { id: "a1", name: "Forklift A", asset_tag: "AMS-000001" },
};
let closed: { adjust: boolean } | null = null;

function mockSession(permissions: string[]) {
  closed = null;
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
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
    if (url.includes("/count")) return Promise.resolve(json(nextOutcome));
    if (url.includes("/close")) {
      closed = JSON.parse(String(init?.body ?? "{}"));
      return Promise.resolve(json({ adjusted: 2 }));
    }
    if (url.includes("/stocktakes/s1")) {
      return Promise.resolve(json({
        session: SESSION, reconciliation: RECONCILIATION,
      }));
    }
    return Promise.resolve(json({ data: [] }));
  });
}

const render = () =>
  renderPage(<StocktakeSession />, { route: "/stocktakes/s1", path: "/stocktakes/:id" });

beforeEach(() => {
  vi.restoreAllMocks();
  nextOutcome = {
    outcome: "expected",
    asset: { id: "a1", name: "Forklift A", asset_tag: "AMS-000001" },
  };
});

describe("StocktakeSession", () => {
  it("shows progress against what was expected", async () => {
    mockSession(["stocktake:read", "stocktake:write"]);
    render();
    await waitFor(() => expect(screen.getByText(/Warehouse/)).toBeInTheDocument());
    expect(screen.getByText(/1 of 3/)).toBeInTheDocument();
  });

  it("lists what is still missing, so the counter knows what to look for", async () => {
    mockSession(["stocktake:read", "stocktake:write"]);
    render();
    await waitFor(() => expect(screen.getByText("Forklift B")).toBeInTheDocument());
    expect(screen.getByText("Pallet truck")).toBeInTheDocument();
  });

  it("confirms a scan by name, not just a tick", async () => {
    // Someone scanning two hundred items needs to know *which* item registered.
    mockSession(["stocktake:read", "stocktake:write"]);
    render();
    await waitFor(() => expect(screen.getByLabelText(/Asset tag/i)).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText(/Asset tag/i), "AMS-000001");
    await userEvent.click(screen.getByRole("button", { name: /^Count$/i }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/Forklift A/));
  });

  it("says plainly when a tag matches nothing", async () => {
    mockSession(["stocktake:read", "stocktake:write"]);
    nextOutcome = { outcome: "unknown_tag" };
    render();
    await waitFor(() => expect(screen.getByLabelText(/Asset tag/i)).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText(/Asset tag/i), "NOPE");
    await userEvent.click(screen.getByRole("button", { name: /^Count$/i }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/no asset/i));
  });

  it("distinguishes a rescan from a fresh count", async () => {
    mockSession(["stocktake:read", "stocktake:write"]);
    nextOutcome = {
      outcome: "already_counted",
      asset: { id: "a1", name: "Forklift A", asset_tag: "AMS-000001" },
    };
    render();
    await waitFor(() => expect(screen.getByLabelText(/Asset tag/i)).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText(/Asset tag/i), "AMS-000001");
    await userEvent.click(screen.getByRole("button", { name: /^Count$/i }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/already counted/i));
  });

  it("flags an asset the register placed somewhere else", async () => {
    mockSession(["stocktake:read", "stocktake:write"]);
    nextOutcome = {
      outcome: "unexpected",
      asset: { id: "z9", name: "Office laptop", asset_tag: "AMS-000099" },
    };
    render();
    await waitFor(() => expect(screen.getByLabelText(/Asset tag/i)).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText(/Asset tag/i), "AMS-000099");
    await userEvent.click(screen.getByRole("button", { name: /^Count$/i }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(/not expected here/i));
  });

  it("clears the field after each scan, ready for the next", async () => {
    mockSession(["stocktake:read", "stocktake:write"]);
    render();
    const field = await screen.findByLabelText(/Asset tag/i);

    await userEvent.type(field, "AMS-000001");
    await userEvent.click(screen.getByRole("button", { name: /^Count$/i }));

    await waitFor(() => expect(field).toHaveValue(""));
  });

  it("asks before writing missing assets off", async () => {
    // Marking two assets lost is not something to do on a single tap.
    mockSession(["stocktake:read", "stocktake:write"]);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render();
    await waitFor(() => expect(screen.getByText(/Warehouse/)).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Close and write off/i }));
    expect(closed).toBeNull();
  });

  it("closes without adjusting when that is what was chosen", async () => {
    mockSession(["stocktake:read", "stocktake:write"]);
    render();
    await waitFor(() => expect(screen.getByText(/Warehouse/)).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Close without/i }));
    await waitFor(() => expect(closed).toEqual({ adjust: false }));
  });

  it("offers no counting to someone who may only read", async () => {
    mockSession(["stocktake:read"]);
    render();
    await waitFor(() => expect(screen.getByText(/Warehouse/)).toBeInTheDocument());
    expect(screen.queryByLabelText(/Asset tag/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Close/i })).not.toBeInTheDocument();
  });
});
