import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, useLocation } from "react-router";
import { AppWrapper } from "../components/common/PageMeta";
import { SidebarProvider } from "../context/SidebarContext";
import { ThemeProvider } from "../context/ThemeContext";
import AppHeader from "./AppHeader";

vi.mock("../components/scan/ScanButton", () => ({ default: () => null }));
vi.mock("../components/header/UserDropdown", () => ({ default: () => null }));

/** Shows where the router ended up, so a navigation can be asserted. */
function Location() {
  const { pathname, search } = useLocation();
  return <div data-testid="where">{pathname + search}</div>;
}

const renderHeader = () =>
  render(
    <AppWrapper>
      <MemoryRouter initialEntries={["/"]}>
        <ThemeProvider>
        <SidebarProvider>
          <AppHeader />
          <Routes>
            <Route path="*" element={<Location />} />
          </Routes>
        </SidebarProvider>
        </ThemeProvider>
      </MemoryRouter>
    </AppWrapper>,
  );

beforeEach(() => vi.clearAllMocks());

describe("the header search", () => {
  it("takes what was typed to the register", async () => {
    // It was template decoration: an uncontrolled input in a form with no
    // handler, so typing did nothing and Enter reloaded the page.
    const user = userEvent.setup();
    renderHeader();

    await user.type(screen.getByLabelText(/search assets/i), "thinkpad{Enter}");
    expect(screen.getByTestId("where")).toHaveTextContent("/assets?q=thinkpad");
  });

  it("escapes what it puts in the URL", async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.type(screen.getByLabelText(/search assets/i), "LT 2026/01{Enter}");
    expect(screen.getByTestId("where"))
      .toHaveTextContent("/assets?q=LT%202026%2F01");
  });

  it("ignores an empty search rather than listing the whole register", async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.type(screen.getByLabelText(/search assets/i), "   {Enter}");
    expect(screen.getByTestId("where")).toHaveTextContent("/");
  });

  it("clears itself, so the next search does not start from the last one", async () => {
    const user = userEvent.setup();
    renderHeader();

    const field = screen.getByLabelText(/search assets/i);
    await user.type(field, "forklift{Enter}");
    expect(field).toHaveValue("");
  });

  it("says what it searches rather than promising commands it does not have", () => {
    renderHeader();
    expect(screen.getByPlaceholderText(/name, tag or serial/i)).toBeInTheDocument();
  });

  it("focuses the field on ctrl-K", async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.keyboard("{Control>}k{/Control}");
    expect(screen.getByLabelText(/search assets/i)).toHaveFocus();
  });

  it("does not submit the form when the shortcut hint is clicked", async () => {
    // It is a button inside a form: without type="button" it submits, and an
    // empty submit used to reload the page.
    const user = userEvent.setup();
    renderHeader();

    await user.click(screen.getByText("K"));
    expect(screen.getByTestId("where")).toHaveTextContent("/");
  });
});
