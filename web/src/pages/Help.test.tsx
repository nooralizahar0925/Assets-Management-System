import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router";
import { AppWrapper } from "../components/common/PageMeta";
import Help from "./Help";

const renderHelp = (route = "/help") =>
  render(
    <AppWrapper>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/help" element={<Help />} />
          <Route path="/help/:slug" element={<Help />} />
        </Routes>
      </MemoryRouter>
    </AppWrapper>,
  );

describe("the help centre", () => {
  it("lists articles grouped by section", () => {
    renderHelp();
    expect(screen.getByText("Getting started")).toBeInTheDocument();
    expect(screen.getByText("Scanning and labels")).toBeInTheDocument();
  });

  it("filters as you type", async () => {
    renderHelp();
    await userEvent.type(screen.getByRole("searchbox"), "barcode");
    expect(screen.getByText(/Scanning labels and printing them/i)).toBeInTheDocument();
    expect(screen.queryByText(/Running and scheduling reports/i)).not.toBeInTheDocument();
  });

  it("finds an article by a word that is nowhere in its title", async () => {
    // Somebody types what they call the thing, not what we called the page.
    renderHelp();
    await userEvent.type(screen.getByRole("searchbox"), "stocktake");
    expect(screen.getByText(/Counting what you actually have/i)).toBeInTheDocument();
  });

  it("tells you when nothing matches, and what to try instead", async () => {
    renderHelp();
    await userEvent.type(screen.getByRole("searchbox"), "zzzznotathing");
    expect(screen.getByText(/No articles match/i)).toBeInTheDocument();
  });

  it("opens one article on its own page", () => {
    renderHelp("/help/scanning");
    expect(screen.getByRole("heading", { level: 1 }))
      .toHaveTextContent("Scanning labels and printing them");
    expect(screen.getByText("Code 128")).toBeInTheDocument();
  });

  it("leads back to the list from an article", () => {
    renderHelp("/help/scanning");
    expect(screen.getByRole("link", { name: /all articles/i }))
      .toHaveAttribute("href", "/help");
  });

  it("says so plainly when an article slug does not exist", () => {
    // The ? panel links here by slug; a renamed article must not be a blank page.
    renderHelp("/help/nonsense");
    expect(screen.getByText(/does not exist/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to the help centre/i }))
      .toBeInTheDocument();
  });

  it("offers the guided tour to somebody who dismissed it", () => {
    renderHelp();
    expect(screen.getByRole("button", { name: /replay the guided tour/i }))
      .toBeInTheDocument();
  });
});
