import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AppWrapper } from "../../components/common/PageMeta";
import Errors from "./Errors";

vi.mock("../../api/developers", () => ({
  developersApi: { errors: vi.fn(), openapi: vi.fn() },
}));

const { developersApi } = await import("../../api/developers");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(developersApi.errors).mockResolvedValue([
    {
      slug: "rate-limited", status: 429, title: "Rate limit exceeded",
      type: "https://ams.dev/errors/rate-limited",
      when: "Too many requests for one API key within the hour.",
      fix: "Wait for the number of seconds in Retry-After, then continue.",
    },
  ]);
});

const renderErrors = () => render(
  <AppWrapper><MemoryRouter><Errors /></MemoryRouter></AppWrapper>,
);

describe("the errors page", () => {
  it("reads the catalogue from the server rather than restating it", async () => {
    renderErrors();
    expect(await screen.findByText("Rate limit exceeded")).toBeInTheDocument();
    expect(developersApi.errors).toHaveBeenCalled();
  });

  it("shows the type URI a caller has in front of them", async () => {
    // The whole point: somebody holding a failed response searches for the
    // exact string in its `type`, not for a paraphrase of the title.
    renderErrors();
    expect(await screen.findByText("https://ams.dev/errors/rate-limited"))
      .toBeInTheDocument();
  });

  it("gives the remedy, not only the cause", async () => {
    renderErrors();
    expect(await screen.findByText(/Retry-After/)).toBeInTheDocument();
  });

  it("says so when the catalogue cannot be loaded", async () => {
    vi.mocked(developersApi.errors).mockRejectedValue(new Error("offline"));
    renderErrors();
    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();
  });
});
