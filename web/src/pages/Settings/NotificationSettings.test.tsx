import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderPage } from "../../test/render";
import NotificationSettings from "./NotificationSettings";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });

const RULES = [
  {
    id: "r1", event: "asset.overdue", channel: "email", template_key: "asset.overdue",
    recipient_spec: { assignee: true }, active: true,
  },
];
const PREFS = [{ event: "asset.overdue", email_enabled: true }];

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
    if (url.includes("/notifications/rules")) return Promise.resolve(json({ data: RULES }));
    if (url.includes("/notifications/preferences")) {
      return Promise.resolve(json({ data: PREFS }));
    }
    return Promise.resolve(json({ data: [] }));
  });
}

const render = () =>
  renderPage(<NotificationSettings />, { route: "/settings/notifications" });

beforeEach(() => vi.restoreAllMocks());

describe("NotificationSettings", () => {
  it("shows everyone their own preferences", async () => {
    // Preferences are per-person and need only assets:read, so a technician
    // must still be able to turn their own emails off.
    mockSession(["assets:read"]);
    render();
    await waitFor(() =>
      expect(screen.getByText("Your preferences")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Save preferences/i })).toBeInTheDocument();
  });

  it("hides the organisation rules from someone who cannot change them", async () => {
    mockSession(["assets:read"]);
    render();
    await waitFor(() =>
      expect(screen.getByText("Your preferences")).toBeInTheDocument());
    expect(screen.queryByText("Organisation rules")).not.toBeInTheDocument();
  });

  it("shows the organisation rules to an administrator", async () => {
    mockSession(["assets:read", "settings:write"]);
    render();
    await waitFor(() =>
      expect(screen.getByText("Organisation rules")).toBeInTheDocument());
    expect(screen.getByText("An asset is overdue")).toBeInTheDocument();
  });
});
