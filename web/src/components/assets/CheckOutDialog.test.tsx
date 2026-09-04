import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AuthProvider } from "../../context/AuthContext";
import userEvent from "@testing-library/user-event";
import CheckOutDialog from "./CheckOutDialog";
import { assetsApi } from "../../api/assets";
import { catalogApi } from "../../api/catalog";
import { ApiError } from "../../api/client";

vi.mock("../../api/assets");
vi.mock("../../api/catalog");

const users = [
  { id: "u1", name: "Rina", email: "rina@example.com", role: "technician" as const },
  { id: "u2", name: "Budi", email: "budi@example.com", role: "manager" as const },
];
const locations = [
  { id: "l1", name: "Site B", parent_id: null, address: null, depth: 0,
    path: "Site B", asset_count: 0 },
  { id: "l2", name: "Site C", parent_id: null, address: null, depth: 0,
    path: "Site C", asset_count: 0 },
];

/** The /me probe AuthProvider makes on mount. */
const mockSession = (locationScope: string[] | null) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({
      org_id: "org-1",
      user: {
        id: "u1", name: "Tester", permissions: ["custody:write"],
        location_scope: locationScope, scopes: [],
      },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  );

beforeEach(() => {
  // Module mocks live for the whole file, so recorded calls carry over between
  // tests. Without this, mock.calls[0] is an earlier test's submit.
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mockSession(null);
  vi.mocked(catalogApi.users).mockResolvedValue(users);
  vi.mocked(catalogApi.locations).mockResolvedValue(locations);
  vi.mocked(assetsApi.checkOut).mockResolvedValue({} as never);
});

const setup = (locationScope: string[] | null = null) => {
  if (locationScope) mockSession(locationScope);
  const onDone = vi.fn();
  render(
    <MemoryRouter>
      <AuthProvider>
        <CheckOutDialog assetId="a1" isOpen onClose={vi.fn()} onDone={onDone} />
      </AuthProvider>
    </MemoryRouter>,
  );
  return { onDone };
};

describe("CheckOutDialog", () => {
  it("defaults to assigning a person", async () => {
    setup();
    await waitFor(() => expect(screen.getByLabelText(/Assign to/)).toBeInTheDocument());
  });

  it("checks out to the chosen user", async () => {
    const { onDone } = setup();
    await waitFor(() => expect(screen.getByLabelText(/Assign to/)).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText(/Assign to/), "u2");
    await userEvent.click(screen.getByRole("button", { name: /Check out/i }));

    await waitFor(() => expect(assetsApi.checkOut).toHaveBeenCalledWith("a1",
      expect.objectContaining({ assignee_type: "user", assignee_id: "u2" })));
    expect(onDone).toHaveBeenCalled();
  });

  it("swaps to a location picker when assigning to a location", async () => {
    setup();
    await userEvent.click(screen.getByRole("radio", { name: /Location/i }));
    expect(await screen.findByLabelText(/Send to/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Assign to/)).not.toBeInTheDocument();
  });

  it("collects a free-text name for an external party", async () => {
    setup();
    await userEvent.click(screen.getByRole("radio", { name: /External/i }));
    await userEvent.type(await screen.findByLabelText(/Name/), "Acme Agency");
    await userEvent.click(screen.getByRole("button", { name: /Check out/i }));

    await waitFor(() => expect(assetsApi.checkOut).toHaveBeenCalledWith("a1",
      expect.objectContaining({
        assignee_type: "external", assignee_label: "Acme Agency",
      })));
  });

  it("sends the due date as an ISO timestamp", async () => {
    setup();
    await waitFor(() => expect(screen.getByLabelText(/Assign to/)).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText(/Due back/), "2026-12-31");
    await userEvent.click(screen.getByRole("button", { name: /Check out/i }));

    await waitFor(() => {
      const body = vi.mocked(assetsApi.checkOut).mock.calls[0][1];
      expect(body.due_at).toMatch(/^2026-12-31T/);
    });
  });

  it("shows the server's explanation when the transition is refused", async () => {
    vi.mocked(assetsApi.checkOut).mockRejectedValue(new ApiError(409, {
      type: "https://ams.dev/errors/invalid-transition",
      title: "Invalid status transition", status: 409,
      detail: "Cannot check out an asset that is retired.",
    }));
    setup();
    await waitFor(() => expect(screen.getByLabelText(/Assign to/)).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /Check out/i }));
    expect(await screen.findByRole("alert"))
      .toHaveTextContent("Cannot check out an asset that is retired.");
  });

  it("does not call onDone when the request fails", async () => {
    vi.mocked(assetsApi.checkOut).mockRejectedValue(new ApiError(409, {
      type: "x", title: "Invalid status transition", status: 409,
    }));
    const { onDone } = setup();
    await waitFor(() => expect(screen.getByLabelText(/Assign to/)).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /Check out/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(onDone).not.toHaveBeenCalled();
  });

  it("offers a branch-scoped user only their own destinations", async () => {
    // Sending an asset to a branch outside their scope makes it vanish from
    // their register the moment they save.
    setup(["l2"]);
    await waitFor(() =>
      expect(screen.getByLabelText(/Assign to/)).toBeInTheDocument());
    await userEvent.click(screen.getByRole("radio", { name: /Location/i }));

    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Site C" })).toBeInTheDocument());
    expect(screen.queryByRole("option", { name: "Site B" })).not.toBeInTheDocument();
  });

  it("offers every destination to an unscoped user", async () => {
    setup();
    await waitFor(() =>
      expect(screen.getByLabelText(/Assign to/)).toBeInTheDocument());
    await userEvent.click(screen.getByRole("radio", { name: /Location/i }));

    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Site B" })).toBeInTheDocument());
    expect(screen.getByRole("option", { name: "Site C" })).toBeInTheDocument();
  });
});
