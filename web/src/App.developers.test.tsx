import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./App";
import { AppWrapper } from "./components/common/PageMeta";

// main.tsx supplies the helmet provider around <App />; without it PageMeta
// throws from inside HelmetDispatcher, nowhere near the cause.
const renderApp = () => render(<AppWrapper><App /></AppWrapper>);

/**
 * Wiring, not content.
 *
 * The page tests render the developer pages directly, which proves nothing
 * about whether they are reachable. This one drives the real route table with
 * no session at all: if /developers ever slips inside RequireAuth, an anonymous
 * reader is bounced to the sign-in form and this fails.
 */

const originalFetch = global.fetch;

beforeEach(() => {
  // No session. The auth bootstrap gets a 401, as an anonymous visitor would.
  global.fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ type: "unauthorized", status: 401, title: "no" }), {
      status: 401, headers: { "content-type": "application/problem+json" },
    }),
  ) as unknown as typeof fetch;
  window.history.pushState({}, "", "/developers");
});

afterEach(() => {
  global.fetch = originalFetch;
  window.history.pushState({}, "", "/");
});

describe("the developer portal's routes", () => {
  it("are reachable without signing in", async () => {
    renderApp();
    expect(await screen.findByRole("heading", { level: 1 }))
      .toHaveTextContent(/Assets Management System API/i);
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
  });

  it("serve the reference under /developers/reference", async () => {
    window.history.pushState({}, "", "/developers/reference");
    renderApp();
    expect(await screen.findByRole("heading", { level: 1 }))
      .toHaveTextContent(/API reference/i);
  });

  it("serve the error catalogue under /developers/errors", async () => {
    window.history.pushState({}, "", "/developers/errors");
    renderApp();
    expect(await screen.findByRole("heading", { level: 1 }))
      .toHaveTextContent(/^Errors$/);
  });
});
