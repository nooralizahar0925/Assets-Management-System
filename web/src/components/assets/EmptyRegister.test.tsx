import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { AuthProvider } from "../../context/AuthContext";
import EmptyRegister from "./EmptyRegister";
import BulkActionBar from "./BulkActionBar";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });

const session = (permissions: string[]) =>
  json({
    org_id: "org-1",
    user: {
      id: "u1", name: "Tester", permissions, location_scope: null, scopes: [],
    },
  });

const renderAs = (permissions: string[], ui: React.ReactNode) => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(session(permissions));
  return render(
    <MemoryRouter>
      <AuthProvider>{ui}</AuthProvider>
    </MemoryRouter>,
  );
};

beforeEach(() => vi.restoreAllMocks());

describe("EmptyRegister", () => {
  it("offers a way to add assets when the register is genuinely empty", async () => {
    renderAs(["assets:import", "assets:write"],
      <EmptyRegister filtered={false} onClear={() => {}} />);

    await waitFor(() =>
      expect(screen.getByText(/no assets yet/i)).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /import a spreadsheet/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /add an asset/i })).toBeInTheDocument();
  });

  it("offers a viewer no actions they cannot take", async () => {
    // Telling someone to import when the API would refuse them is worse than
    // saying nothing.
    renderAs(["assets:read"], <EmptyRegister filtered={false} onClear={() => {}} />);

    await waitFor(() =>
      expect(screen.getByText(/no assets yet/i)).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: /import/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /add an asset/i })).not.toBeInTheDocument();
  });

  it("says something different when filters are what emptied it", async () => {
    // "Import your first assets" is wrong advice mid-search, and "clear
    // filters" is wrong advice on day one.
    const onClear = vi.fn();
    renderAs(["assets:read"], <EmptyRegister filtered onClear={onClear} />);

    await waitFor(() =>
      expect(screen.getByText(/nothing matches those filters/i)).toBeInTheDocument());
    expect(screen.queryByText(/no assets yet/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /clear filters/i }));
    expect(onClear).toHaveBeenCalled();
  });
});

describe("BulkActionBar permission gating", () => {
  const selected = new Set(["a1", "a2"]);

  it("shows nothing actionable to a viewer", async () => {
    renderAs(["assets:read"],
      <BulkActionBar selected={selected} onClear={() => {}} onChanged={() => {}} />);

    await waitFor(() => expect(screen.getByText(/2 selected/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /print/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retire/i })).not.toBeInTheDocument();
  });

  it("shows label printing but not retirement to a technician", async () => {
    // A technician prints labels and updates assets, but retiring one is a
    // manager's call - the API enforces exactly this split.
    renderAs(["assets:read", "labels:print"],
      <BulkActionBar selected={selected} onClear={() => {}} onChanged={() => {}} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /print qr labels/i })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /retire/i })).not.toBeInTheDocument();
  });

  it("shows everything to someone who can write and print", async () => {
    renderAs(["assets:write", "labels:print"],
      <BulkActionBar selected={selected} onClear={() => {}} onChanged={() => {}} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /print qr labels/i })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /retire/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send to maintenance/i })).toBeInTheDocument();
  });
});
