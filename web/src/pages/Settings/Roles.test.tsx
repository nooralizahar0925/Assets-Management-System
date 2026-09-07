import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderPage } from "../../test/render";
import Roles from "./Roles";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });

const ROLES = [
  {
    id: "r1", name: "Administrator", description: "Runs the organisation.",
    is_system: true, permissions: ["assets:read", "roles:write"], user_count: 2,
  },
  {
    id: "r2", name: "Warehouse supervisor", description: "",
    is_system: false, permissions: ["assets:read"], user_count: 0,
  },
];

const GROUPS = [
  {
    group: "Assets",
    permissions: [
      { key: "assets:read", group: "Assets", label: "View assets",
        description: "See the asset register." },
      { key: "assets:write", group: "Assets", label: "Create and edit assets" },
    ],
  },
  {
    group: "Administration",
    permissions: [
      { key: "roles:write", group: "Administration", label: "Manage roles" },
    ],
  },
];

/** Captures what the page sends, so the payload can be asserted. */
let sent: { method: string; body: unknown } | null = null;

function mockSession(permissions: string[], deleteStatus = 204) {
  sent = null;
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (url.includes("/auth/me")) {
      return Promise.resolve(json({
        org_id: "org-1",
        user: {
          id: "me", name: "Tester", permissions,
          location_scope: null, scopes: [],
        },
      }));
    }
    if (url.includes("/admin/permissions")) return Promise.resolve(json({ data: GROUPS }));
    if (url.includes("/admin/roles")) {
      if (method === "GET") return Promise.resolve(json({ data: ROLES }));
      if (method === "DELETE") {
        return deleteStatus === 204
          ? Promise.resolve(new Response(null, { status: 204 }))
          : Promise.resolve(json({
              type: "conflict", status: 409, title: "Conflict",
              detail: "2 people still hold this role. Move them to another role first.",
            }, 409));
      }
      sent = { method, body: JSON.parse(String(init?.body ?? "null")) };
      return Promise.resolve(json({ id: "r3" }));
    }
    return Promise.resolve(json({ data: [] }));
  });
}

const render = () => renderPage(<Roles />, { route: "/settings/roles" });

beforeEach(() => vi.restoreAllMocks());

describe("Roles", () => {
  it("lists roles with who holds them", async () => {
    mockSession(["roles:read"]);
    render();
    await waitFor(() => expect(screen.getByText("Administrator")).toBeInTheDocument());
    expect(screen.getByText("2 people")).toBeInTheDocument();
    expect(screen.getByText("Warehouse supervisor")).toBeInTheDocument();
  });

  it("shows a reader no way to change anything", async () => {
    mockSession(["roles:read"]);
    render();
    await waitFor(() => expect(screen.getByText("Administrator")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Add role/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit$/ })).not.toBeInTheDocument();
  });

  it("does not offer to delete a role the product ships with", async () => {
    // The API refuses it, so offering the button would only produce a 403.
    mockSession(["roles:read", "roles:write"]);
    render();
    await waitFor(() => expect(screen.getByText("Administrator")).toBeInTheDocument());
    // Only the custom role gets a Delete button.
    expect(screen.getAllByRole("button", { name: /Delete/i })).toHaveLength(1);
  });

  it("sends the ticked permissions when creating a role", async () => {
    mockSession(["roles:read", "roles:write"]);
    render();
    await waitFor(() => expect(screen.getByText("Administrator")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Add role/i }));
    await userEvent.type(screen.getByLabelText(/Name/), "Auditor");
    await userEvent.click(screen.getByRole("checkbox", { name: /View assets/i }));
    await userEvent.click(screen.getByRole("button", { name: /Save role/i }));

    await waitFor(() => expect(sent).not.toBeNull());
    expect(sent!.method).toBe("POST");
    expect(sent!.body).toMatchObject({
      name: "Auditor", permissions: ["assets:read"],
    });
  });

  it("refuses to save a role with no permissions", async () => {
    // The API requires at least one; disabling the button says so before the
    // round trip.
    mockSession(["roles:read", "roles:write"]);
    render();
    await waitFor(() => expect(screen.getByText("Administrator")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Add role/i }));
    await userEvent.type(screen.getByLabelText(/Name/), "Empty");
    expect(screen.getByRole("button", { name: /Save role/i })).toBeDisabled();
  });

  it("explains why a role still in use cannot be deleted", async () => {
    mockSession(["roles:read", "roles:write"], 409);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render();
    await waitFor(() =>
      expect(screen.getByText("Warehouse supervisor")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /Delete/i }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/still hold this role/i));
  });

  it("turns away someone who cannot read roles", async () => {
    mockSession(["assets:read"]);
    render();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/managed by an administrator/i));
  });
});
