import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderPage } from "../../test/render";
import Users from "./Users";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });

const MEMBERS = [
  {
    id: "u1", name: "Rina", email: "rina@example.com",
    role_id: "r1", role_name: "Technician", location_ids: [], assigned_count: 3,
  },
  {
    id: "u2", name: "Budi", email: "budi@example.com",
    role_id: "r2", role_name: "Branch manager", location_ids: ["l1"], assigned_count: 0,
  },
];

const INVITATIONS = [
  {
    id: "i1", email: "waiting@example.com", name: "Waiting Person",
    role_id: "r1", role_name: "Technician",
    expires_at: "2026-12-01T09:00:00Z", created_at: "2026-11-28T09:00:00Z",
  },
];

function mockSession(permissions: string[]) {
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = String(input);
    if (url.includes("/auth/me")) {
      return Promise.resolve(json({
        org_id: "org-1",
        user: {
          id: "me", name: "Tester", permissions,
          location_scope: null, scopes: [],
        },
      }));
    }
    if (url.includes("/admin/users")) {
      return Promise.resolve(json({ data: MEMBERS, invitations: INVITATIONS }));
    }
    if (url.includes("/admin/roles")) {
      return Promise.resolve(json({ data: [
        { id: "r1", name: "Technician", description: null, is_system: true,
          permissions: [], user_count: 1 },
      ] }));
    }
    return Promise.resolve(json({ data: [] }));
  });
}

const render = () => renderPage(<Users />, { route: "/settings/users" });

beforeEach(() => vi.restoreAllMocks());

describe("Users", () => {
  it("shows each person with the email and role the admin endpoint returns", async () => {
    // The check-out picker at /api/v1/users returns neither, so this page has
    // to read /api/admin/users or every row renders blank.
    mockSession(["users:read"]);
    render();
    await waitFor(() => expect(screen.getByText("Rina")).toBeInTheDocument());
    expect(screen.getByText("rina@example.com")).toBeInTheDocument();
    expect(screen.getByText("Technician")).toBeInTheDocument();
  });

  it("marks who is limited to particular branches", async () => {
    mockSession(["users:read"]);
    render();
    await waitFor(() => expect(screen.getByText("Budi")).toBeInTheDocument());
    expect(screen.getByText("1 branch")).toBeInTheDocument();
  });

  it("offers no way to change a role without users:write", async () => {
    mockSession(["users:read"]);
    render();
    await waitFor(() => expect(screen.getByText("Rina")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Change role/i })).not.toBeInTheDocument();
  });

  it("lets an administrator change someone's role", async () => {
    mockSession(["users:read", "users:write", "roles:read"]);
    render();
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /Change role/i })).toHaveLength(2));
  });

  it("turns away someone who cannot read the directory", async () => {
    mockSession(["assets:read"]);
    render();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/managed by an administrator/i));
    expect(screen.queryByText("Rina")).not.toBeInTheDocument();
  });
});

describe("inviting a colleague", () => {
  it("offers the form to somebody who can manage people", async () => {
    // Until this existed the onboarding checklist told people to invite
    // colleagues using a page that could only list the ones already there.
    mockSession(["users:read", "users:write", "roles:read"]);
    render();
    expect(await screen.findByLabelText(/^email$/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send invitation/i })).toBeInTheDocument();
  });

  it("offers no form to somebody who cannot", async () => {
    mockSession(["users:read"]);
    render();
    await waitFor(() => expect(screen.getByText("Rina")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /send invitation/i }))
      .not.toBeInTheDocument();
  });

  it("will not send until there is a name, an address and a role", async () => {
    mockSession(["users:read", "users:write", "roles:read"]);
    render();
    await screen.findByLabelText(/^email$/i);
    expect(screen.getByRole("button", { name: /send invitation/i })).toBeDisabled();
  });

  it("shows who has been invited and not yet accepted", async () => {
    // Without this an administrator invites the same person twice and wonders
    // why nothing happened the first time.
    mockSession(["users:read", "users:write", "roles:read"]);
    render();
    expect(await screen.findByText("Waiting Person")).toBeInTheDocument();
    expect(screen.getByText(/waiting@example.com/)).toBeInTheDocument();
  });

  it("shows the expiry as a date, not a timestamp", async () => {
    mockSession(["users:read", "users:write", "roles:read"]);
    render();
    await screen.findByText("Waiting Person");
    expect(screen.getByText(/1 Dec 2026/)).toBeInTheDocument();
  });
});
