import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { AppWrapper } from "../components/common/PageMeta";
import Organisations from "./Organisations";

vi.mock("../api/platform", () => ({
  platformApi: { organisations: vi.fn() },
}));

const { platformApi } = await import("../api/platform");

const day = 86_400_000;
const inDays = (n: number) => new Date(Date.now() + n * day).toISOString().slice(0, 10);

const ROWS = [
  {
    id: "o1", name: "Acme Ltd", slug: "acme", plan_code: "professional",
    suspended_at: null, trial_ends_at: null, renews_on: "2027-03-01",
    created_at: "2026-01-01T00:00:00Z", assets: 1284, users: 12,
  },
  {
    id: "o2", name: "Bekasi Works", slug: "bekasi", plan_code: "starter",
    suspended_at: "2026-08-01T00:00:00Z", trial_ends_at: null, renews_on: null,
    created_at: "2026-02-01T00:00:00Z", assets: 40, users: 3,
  },
  {
    id: "o3", name: "Trial Co", slug: "trial-co", plan_code: "starter",
    suspended_at: null, trial_ends_at: inDays(3), renews_on: null,
    created_at: "2026-09-01T00:00:00Z", assets: 0, users: 1,
  },
  {
    id: "o4", name: "Unplaced Ltd", slug: "unplaced", plan_code: null,
    suspended_at: null, trial_ends_at: null, renews_on: null,
    created_at: "2026-09-05T00:00:00Z", assets: 0, users: 1,
  },
];

const renderList = () =>
  render(
    <AppWrapper><MemoryRouter><Organisations /></MemoryRouter></AppWrapper>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(platformApi.organisations).mockResolvedValue({ data: ROWS });
});

describe("the customer list", () => {
  it("lists every customer with what they hold and what they are on", async () => {
    renderList();
    expect(await screen.findByText("Acme Ltd")).toBeInTheDocument();
    expect(screen.getByText("professional")).toBeInTheDocument();
    expect(screen.getByText("1,284")).toBeInTheDocument();
  });

  it("shows the ones who have not started yet", async () => {
    // These are exactly the customers worth seeing: a plain join in the query
    // behind this would have dropped them for having no assets.
    renderList();
    expect(await screen.findByText("Unplaced Ltd")).toBeInTheDocument();
  });

  it("marks a suspended customer with a word, not a colour alone", async () => {
    // Colour alone fails a colour-blind reader, and fails in a screenshot.
    renderList();
    await screen.findByText("Bekasi Works");
    // Scoped to the table: the filter beside it lists the same words as
    // options, and matching one of those would prove nothing.
    expect(within(screen.getByRole("table")).getByText("Suspended"))
      .toBeInTheDocument();
  });

  it("says how long a trial has left rather than a date to subtract", async () => {
    renderList();
    await screen.findByText("Trial Co");
    const table = within(screen.getByRole("table"));
    expect(table.getByText("Trial ending")).toBeInTheDocument();
    expect(table.getByText("in 3 days")).toBeInTheDocument();
  });

  it("marks a customer with no plan, which is a thing to do something about", async () => {
    renderList();
    await screen.findByText("Unplaced Ltd");
    expect(within(screen.getByRole("table")).getByText("No plan"))
      .toBeInTheDocument();
  });

  it("shows a renewal as a date, not a timestamp", async () => {
    renderList();
    await screen.findByText("Acme Ltd");
    expect(screen.getByText("1 Mar 2027")).toBeInTheDocument();
  });

  it("narrows by name or slug", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText("Acme Ltd");

    await user.type(screen.getByLabelText(/search customers/i), "bekasi");
    expect(screen.getByText("Bekasi Works")).toBeInTheDocument();
    expect(screen.queryByText("Acme Ltd")).not.toBeInTheDocument();
  });

  it("narrows by status", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText("Acme Ltd");

    await user.selectOptions(screen.getByLabelText(/filter by status/i), "suspended");
    expect(screen.getByText("Bekasi Works")).toBeInTheDocument();
    expect(screen.queryByText("Acme Ltd")).not.toBeInTheDocument();
  });

  it("says so when nothing matches, rather than showing an empty table", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText("Acme Ltd");

    await user.type(screen.getByLabelText(/search customers/i), "zzzznothing");
    expect(screen.getByText(/no customer matches/i)).toBeInTheDocument();
  });

  it("tells a brand-new deployment what to do first", async () => {
    vi.mocked(platformApi.organisations).mockResolvedValue({ data: [] });
    renderList();

    expect(await screen.findByText(/no customers yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /create a customer/i }))
      .toHaveAttribute("href", "/platform/new");
  });

  it("says plainly when the list could not be loaded", async () => {
    vi.mocked(platformApi.organisations).mockRejectedValue(new Error("offline"));
    renderList();
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be loaded/i);
  });

  it("offers a way to take on a new customer", async () => {
    renderList();
    expect(await screen.findByRole("link", { name: /new customer/i }))
      .toHaveAttribute("href", "/platform/new");
  });

  it("leads to one customer", async () => {
    renderList();
    expect(await screen.findByRole("link", { name: "Acme Ltd" }))
      .toHaveAttribute("href", "/platform/o1");
  });
});
