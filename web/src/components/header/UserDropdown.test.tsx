import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderPage } from "../../test/render";
import UserDropdown from "./UserDropdown";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });

const calls: { url: string; method: string }[] = [];

function mockSession(locationScope: string[] | null = null) {
  calls.length = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET" });
    if (url.includes("/auth/logout")) {
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (url.includes("/auth/me")) {
      return Promise.resolve(json({
        org_id: "org-1",
        user: {
          id: "u1", name: "Ayu Lestari",
          permissions: ["assets:read", "assets:write"],
          location_scope: locationScope, scopes: [],
        },
      }));
    }
    return Promise.resolve(json({ data: [] }));
  });
}

beforeEach(() => vi.restoreAllMocks());

describe("UserDropdown", () => {
  it("shows the signed-in person, not a hardcoded name", async () => {
    mockSession();
    renderPage(<UserDropdown />, { route: "/" });
    await waitFor(() => expect(screen.getByText("Ayu Lestari")).toBeInTheDocument());
  });

  it("signs out through the API rather than just navigating", async () => {
    // The template menu linked straight to /signin, which left the session
    // cookie in place - it looked like signing out without being one.
    mockSession();
    renderPage(<UserDropdown />, { route: "/" });
    await waitFor(() => expect(screen.getByText("Ayu Lestari")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { expanded: false }));
    await userEvent.click(screen.getByRole("button", { name: /Sign out/i }));

    await waitFor(() =>
      expect(calls.some((c) => c.url.includes("/auth/logout") && c.method === "POST"))
        .toBe(true));
  });

  it("says whether the person is limited to branches", async () => {
    mockSession(["loc-1", "loc-2"]);
    renderPage(<UserDropdown />, { route: "/" });
    await waitFor(() => expect(screen.getByText("Ayu Lestari")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText(/2 branches/)).toBeInTheDocument();
  });

  it("renders nothing when nobody is signed in", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ title: "Unauthorized" }, 401));
    const { container } = renderPage(<UserDropdown />, { route: "/" });
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
