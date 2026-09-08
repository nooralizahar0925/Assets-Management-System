import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { render } from "@testing-library/react";
import { AppWrapper } from "../../components/common/PageMeta";
import DevelopersLayout from "./DevelopersLayout";
import Overview from "./Overview";
import Authentication from "./Authentication";
import Conventions from "./Conventions";

/**
 * No AuthProvider here, deliberately.
 *
 * The portal is public; if a page ever starts reading the session, these tests
 * fail rather than passing because a provider the real route tree supplies
 * happened to be present in the test.
 */
function renderAt(route: string) {
  return render(
    <AppWrapper>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/developers" element={<DevelopersLayout />}>
            <Route index element={<Overview />} />
            <Route path="authentication" element={<Authentication />} />
            <Route path="conventions" element={<Conventions />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AppWrapper>,
  );
}

describe("the developer portal shell", () => {
  it("renders without a session, because a reader has no credential yet", () => {
    renderAt("/developers");
    expect(screen.getByRole("heading", { level: 1 }))
      .toHaveTextContent(/Assets Management System API/i);
  });

  it("offers every documentation page in the sidebar", () => {
    renderAt("/developers");
    const nav = screen.getByRole("navigation", { name: /developer documentation/i });
    for (const label of [
      "Overview", "Authentication", "Conventions", "API reference", "Errors",
    ]) {
      expect(nav).toHaveTextContent(label);
    }
  });

  it("marks only the page being read as current", () => {
    renderAt("/developers/authentication");
    const current = screen.getByRole("link", { current: "page" });
    expect(current).toHaveTextContent("Authentication");
  });

  it("does not mark Overview current on a child page", () => {
    // Overview links to /developers, which prefix-matches every other page.
    // Without `end` on that NavLink two entries highlight at once.
    renderAt("/developers/conventions");
    expect(screen.getAllByRole("link", { current: "page" })).toHaveLength(1);
  });

  it("leads back to the application", () => {
    renderAt("/developers");
    expect(screen.getByRole("link", { name: /open the application/i }))
      .toHaveAttribute("href", "/");
  });

  it("tells an integrator the key is shown only once", () => {
    renderAt("/developers/authentication");
    expect(screen.getByText(/shown once/i)).toBeInTheDocument();
  });

  it("documents idempotent retries, the thing a timeout makes urgent", () => {
    renderAt("/developers/conventions");
    expect(screen.getAllByText(/Idempotency-Key/).length).toBeGreaterThan(0);
  });

  it("warns that signatures are verified against the raw body", () => {
    // Re-encoding the JSON produces different bytes; a reader who misses this
    // ships a webhook receiver that rejects every valid delivery.
    renderAt("/developers/conventions");
    expect(screen.getByText(/raw body/i)).toBeInTheDocument();
  });
});
