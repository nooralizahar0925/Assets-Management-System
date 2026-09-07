import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import HelpButton, { topicForPath } from "./HelpButton";

const renderAt = (route: string) =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <HelpButton />
    </MemoryRouter>,
  );

describe("choosing the topic for a URL", () => {
  it("uses the topic for the page being read", () => {
    expect(topicForPath("/assets")?.title).toBe("The asset register");
  });

  it("resolves a route with a parameter", () => {
    expect(topicForPath("/assets/8f14e45f-ceea-467a-9f0b-1c2d3e4f5a6b")?.title)
      .toBe("Asset detail");
  });

  it("prefers an exact page over a pattern that would also match it", () => {
    // "/assets/new" is a perfectly good value for ":id". Without the exact
    // check first, somebody adding an asset is shown how to read its history.
    expect(topicForPath("/assets/new")?.title).toBe("Adding an asset");
  });

  it("resolves a nested parameter route", () => {
    expect(topicForPath("/assets/abc/edit")?.title).toBe("Editing an asset");
  });

  it("has no topic for a page that is not part of the application", () => {
    expect(topicForPath("/nonsense")).toBeUndefined();
  });
});

describe("contextual help", () => {
  it("stays closed until asked", () => {
    renderAt("/assets");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the topic for the current page", async () => {
    renderAt("/assets");
    await userEvent.click(screen.getByRole("button", { name: /help with/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("The asset register")).toBeInTheDocument();
  });

  it("explains the words on the page that cannot be guessed", async () => {
    renderAt("/categories");
    await userEvent.click(screen.getByRole("button", { name: /help with/i }));
    expect(screen.getByText("Field schema")).toBeInTheDocument();
  });

  it("closes again", async () => {
    renderAt("/assets");
    await userEvent.click(screen.getByRole("button", { name: /help with/i }));
    await userEvent.click(screen.getByRole("button", { name: /close help/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes on Escape, like every other dialog", async () => {
    renderAt("/assets");
    await userEvent.click(screen.getByRole("button", { name: /help with/i }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("moves focus into the panel so a keyboard user is not left behind", async () => {
    renderAt("/assets");
    await userEvent.click(screen.getByRole("button", { name: /help with/i }));
    expect(screen.getByRole("button", { name: /close help/i })).toHaveFocus();
  });

  it("renders nothing at all on a page with no topic", () => {
    const { container } = renderAt("/nonsense");
    expect(container).toBeEmptyDOMElement();
  });
});

describe("getting back to the tour", () => {
  it("offers a replay, because a dismissed tour has no other way back", async () => {
    renderAt("/assets");
    await userEvent.click(screen.getByRole("button", { name: /help with/i }));
    expect(screen.getByRole("button", { name: /replay the tour/i })).toBeInTheDocument();
  });
});
