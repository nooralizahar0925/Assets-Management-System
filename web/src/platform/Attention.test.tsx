import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { AppWrapper } from "../components/common/PageMeta";
import Attention from "./Attention";
import type { AttentionItem } from "../api/platform";

vi.mock("../api/platform", async () => {
  const actual = await vi.importActual<typeof import("../api/platform")>(
    "../api/platform",
  );
  return { ...actual, platformApi: { attention: vi.fn() } };
});

const { platformApi } = await import("../api/platform");

const ITEMS: AttentionItem[] = [
  {
    org_id: "o1", name: "Acme Ltd", slug: "acme",
    reasons: [
      { kind: "over-limit", detail: "Holds 620 assets against a limit of 500" },
      { kind: "renewal-due", detail: "Renews 01 Oct 2026" },
    ],
  },
  {
    org_id: "o2", name: "Trial Co", slug: "trial-co",
    reasons: [{ kind: "trial-ending", detail: "Trial ends 14 Sep 2026" }],
  },
];

const renderPage = () =>
  render(
    <AppWrapper><MemoryRouter><Attention /></MemoryRouter></AppWrapper>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(platformApi.attention).mockResolvedValue({ data: ITEMS });
});

describe("what needs attention", () => {
  it("lists a customer once, with every reason beside them", async () => {
    // The operator rings a customer, not a reason. Two rows for Acme would
    // mean two phone calls that are really one conversation.
    renderPage();

    const acme = (await screen.findByText("Acme Ltd")).closest("li")!;
    expect(within(acme).getByText(/620 assets against a limit of 500/))
      .toBeInTheDocument();
    expect(within(acme).getByText(/Renews 01 Oct 2026/)).toBeInTheDocument();
  });

  it("counts customers, not reasons", async () => {
    // Otherwise the badge says three when there are two people to ring.
    renderPage();
    await screen.findByText("Acme Ltd");
    expect(screen.getByText("2 customers")).toBeInTheDocument();
  });

  it("says what each reason is, not only that there is one", async () => {
    renderPage();
    await screen.findByText("Acme Ltd");
    expect(screen.getByText("Over their limit")).toBeInTheDocument();
    expect(screen.getByText("Trial")).toBeInTheDocument();
  });

  it("leads to the customer it is talking about", async () => {
    renderPage();
    expect(await screen.findByRole("link", { name: "Acme Ltd" }))
      .toHaveAttribute("href", "/platform/o1");
  });

  it("says nothing at all when nothing needs deciding", async () => {
    // An empty list is the right answer, not a page of zeroes.
    vi.mocked(platformApi.attention).mockResolvedValue({ data: [] });
    renderPage();

    expect(await screen.findByText(/nothing needs deciding/i)).toBeInTheDocument();
    expect(screen.queryByText(/customers$/)).not.toBeInTheDocument();
  });

  it("says plainly when it could not be loaded", async () => {
    vi.mocked(platformApi.attention).mockRejectedValue(new Error("offline"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be loaded/i);
  });

  it("offers the full list for when nothing is urgent", async () => {
    renderPage();
    expect(await screen.findByRole("link", { name: /all customers/i }))
      .toHaveAttribute("href", "/platform/customers");
  });
});
