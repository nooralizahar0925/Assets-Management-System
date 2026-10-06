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
  it("shows a guide index beside the first article", () => {
    renderHelp();
    expect(screen.getByRole("navigation", { name: "Guide topics" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Scanning and labels" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Setting up your register" })).toBeInTheDocument();
  });

  it("filters as you type", async () => {
    renderHelp();
    await userEvent.type(screen.getByRole("searchbox"), "barcode");
    expect(screen.getByText(/Scanning labels and printing them/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Running and scheduling reports/i })).not.toBeInTheDocument();
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
    expect(screen.getByText(/No guides match/i)).toBeInTheDocument();
  });

  it("opens a deep-linked article in the guide layout", () => {
    renderHelp("/help/scanning");
    expect(screen.getByRole("heading", { level: 2, name: "Scanning labels and printing them" }))
      .toHaveTextContent("Scanning labels and printing them");
    expect(screen.getByText("Code 128")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print this guide" })).toBeInTheDocument();
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

  it("offers a first-time walkthrough with saved progress", async () => {
    localStorage.clear();
    renderHelp();
    await userEvent.click(screen.getByRole("button", { name: "Open walkthrough" }));
    expect(screen.getByText("Step 1 of 8")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(screen.getByText("Explore the asset register")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("ams.guide.walkthrough.v1.guest") ?? "null").id).toBe("register");
  });
});
