import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { AppWrapper } from "../../components/common/PageMeta";
import Recipes from "./Recipes";
import { RECIPES } from "../../content/recipes";

const renderPage = () => render(
  <AppWrapper><MemoryRouter><Recipes /></MemoryRouter></AppWrapper>,
);

describe("the recipes page", () => {
  it("shows every flow", () => {
    renderPage();
    for (const recipe of RECIPES) {
      expect(screen.getByRole("heading", { name: recipe.title })).toBeInTheDocument();
    }
  });

  it("opens on cURL, the one a reader can paste into a terminal", () => {
    renderPage();
    const tabs = screen.getAllByRole("tab", { name: "cURL" });
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
  });

  it("switches one recipe's language without switching the others", async () => {
    // Shared state here would be worse than useless: a reader comparing two
    // flows in Python would find one of them silently in PHP.
    const user = userEvent.setup();
    renderPage();
    const pythonTabs = screen.getAllByRole("tab", { name: "Python" });
    await user.click(pythonTabs[0]);

    expect(pythonTabs[0]).toHaveAttribute("aria-selected", "true");
    expect(pythonTabs[1]).toHaveAttribute("aria-selected", "false");
    expect(screen.getByText(/import requests/)).toBeInTheDocument();
  });

  it("renders the real endpoint, not a plausible-looking one", () => {
    renderPage();
    expect(screen.getByText(/assets\/<asset-uuid>\/checkout/)).toBeInTheDocument();
  });
});
