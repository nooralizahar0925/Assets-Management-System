import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuthProvider, useAuth } from "./AuthContext";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });

function Probe() {
  const { user, loading, signIn, signOut, can } = useAuth();
  if (loading) return <p>loading</p>;
  return (
    <div>
      <p data-testid="user">{user ? user.name : "anonymous"}</p>
      <p data-testid="can-write">{String(can("assets:write"))}</p>
      <button onClick={() => signIn("rina@example.com", "pw")}>sign in</button>
      <button onClick={() => signOut()}>sign out</button>
    </div>
  );
}

const renderProbe = () =>
  render(<AuthProvider><Probe /></AuthProvider>);

beforeEach(() => vi.restoreAllMocks());

describe("AuthProvider", () => {
  it("restores an existing session on mount", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({
      org_id: "org-1",
      user: { id: "u1", name: "Rina", scopes: ["assets:read", "assets:write"] },
    }));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("Rina"));
  });

  it("shows anonymous when there is no session", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ title: "Authentication required" }, 401));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("anonymous"));
  });

  it("signs a user in and keeps their identity", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json({ title: "Authentication required" }, 401))
      .mockResolvedValueOnce(json({ id: "u1", name: "Rina", org_id: "org-1", role: "admin" }))
      .mockResolvedValueOnce(json({
        org_id: "org-1", user: { id: "u1", name: "Rina", scopes: ["admin"] },
      }));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("anonymous"));
    await userEvent.click(screen.getByText("sign in"));
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("Rina"));
  });

  it("clears the user on sign out", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json({
        org_id: "org-1", user: { id: "u1", name: "Rina", scopes: ["admin"] },
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("Rina"));
    await userEvent.click(screen.getByText("sign out"));
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("anonymous"));
  });

  it("reports scopes through can()", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({
      org_id: "org-1", user: { id: "u1", name: "Vera", scopes: ["assets:read"] },
    }));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("can-write")).toHaveTextContent("false"));
  });

  it("treats the admin scope as granting everything", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({
      org_id: "org-1", user: { id: "u1", name: "Ada", scopes: ["admin"] },
    }));
    renderProbe();
    await waitFor(() => expect(screen.getByTestId("can-write")).toHaveTextContent("true"));
  });
});
