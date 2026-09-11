import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { AppWrapper } from "../components/common/PageMeta";
import { ApiError } from "../api/client";
import PlanEditor from "./PlanEditor";
import type { Feature, OrganisationRow, Plan } from "../api/platform";

vi.mock("../api/platform", async () => {
  const actual = await vi.importActual<typeof import("../api/platform")>(
    "../api/platform",
  );
  return {
    ...actual,
    platformApi: {
      plans: vi.fn(),
      organisations: vi.fn(),
      createPlan: vi.fn(),
      updatePlan: vi.fn(),
      deletePlan: vi.fn(),
    },
  };
});

const { platformApi } = await import("../api/platform");

const PLANS: Plan[] = [
  {
    code: "starter", name: "Starter", description: "For one site.",
    price_minor: 250_000, currency: "IDR", billing_cycle: "monthly",
    features: ["core", "labels"], limits: { max_assets: 500 },
    active: true, sort_order: 1,
  },
  {
    code: "professional", name: "Professional", description: "",
    price_minor: 950_000, currency: "IDR", billing_cycle: "monthly",
    features: ["core", "labels", "reports"], limits: {},
    active: true, sort_order: 2,
  },
];

const FEATURES: Feature[] = [
  { key: "core", group: "Core", label: "Asset register", description: "The register." },
  { key: "labels", group: "Operations", label: "Labels and scanning", description: "Labels." },
  { key: "reports", group: "Finance", label: "Reports", description: "Reports." },
];

const org = (id: string, plan_code: string | null): OrganisationRow => ({
  id, name: `Org ${id}`, slug: id, plan_code, suspended_at: null,
  trial_ends_at: null, renews_on: null, created_at: "2026-01-01T00:00:00Z",
  assets: 0, users: 0,
});

const renderPage = () =>
  render(<AppWrapper><MemoryRouter><PlanEditor /></MemoryRouter></AppWrapper>);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(platformApi.plans).mockResolvedValue({ data: PLANS, features: FEATURES });
  vi.mocked(platformApi.organisations).mockResolvedValue({
    data: [org("a", "starter"), org("b", "starter"), org("c", null)],
  });
});

describe("the plan list", () => {
  it("shows what each plan costs, in the currency it is sold in", async () => {
    renderPage();
    const starter = (await screen.findByText("Starter")).closest("li")!;
    expect(within(starter).getByText(/IDR\s*250,000/)).toBeInTheDocument();
    expect(within(starter).getByText(/monthly/i)).toBeInTheDocument();
  });

  it("says how many customers are on each plan", async () => {
    // Repricing a plan two customers are on is a different decision from
    // repricing one nobody has bought, and the operator should see which.
    renderPage();
    const starter = (await screen.findByText("Starter")).closest("li")!;
    expect(within(starter).getByText(/2 customers/)).toBeInTheDocument();
  });

  it("says nobody is on an unsold plan, rather than leaving it blank", async () => {
    renderPage();
    const pro = (await screen.findByText("Professional")).closest("li")!;
    expect(within(pro).getByText(/no customers/i)).toBeInTheDocument();
  });

  it("names what a plan includes, not only how many features", async () => {
    renderPage();
    const starter = (await screen.findByText("Starter")).closest("li")!;
    expect(within(starter).getByText(/Labels and scanning/)).toBeInTheDocument();
  });

  it("says plainly when the plans could not be loaded", async () => {
    vi.mocked(platformApi.plans).mockRejectedValue(new Error("offline"));
    renderPage();
    expect(await screen.findByRole("alert"))
      .toHaveTextContent(/could not be loaded/i);
  });
});

describe("editing a plan", () => {
  it("sends the change under the code the plan already has", async () => {
    vi.mocked(platformApi.updatePlan).mockResolvedValue(PLANS[0]);
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /edit Starter/i }));
    const name = screen.getByLabelText(/^name$/i);
    await userEvent.clear(name);
    await userEvent.type(name, "Starter plus");
    await userEvent.click(screen.getByRole("button", { name: /save plan/i }));

    await waitFor(() => expect(platformApi.updatePlan).toHaveBeenCalled());
    const [code, patch] = vi.mocked(platformApi.updatePlan).mock.calls[0];
    expect(code).toBe("starter");
    expect(patch).toMatchObject({ name: "Starter plus" });
  });

  it("will not let the code be changed, because it is the identity", async () => {
    // Renaming it would silently create a second plan and strand everybody on
    // the first one.
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /edit Starter/i }));
    expect(screen.getByLabelText(/code/i)).toBeDisabled();
  });

  it("keeps the register on, whatever the operator clicks", async () => {
    // Every plan includes it; a plan sold without it would be an account that
    // can sign in and do nothing.
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /edit Starter/i }));
    const core = screen.getByRole("checkbox", { name: /asset register/i });
    expect(core).toBeChecked();
    expect(core).toBeDisabled();
  });

  it("treats a blank limit as unlimited rather than zero", async () => {
    // A limit of zero refuses every write, which is not what an empty box means.
    vi.mocked(platformApi.updatePlan).mockResolvedValue(PLANS[0]);
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /edit Starter/i }));
    await userEvent.clear(screen.getByLabelText(/assets/i));
    await userEvent.click(screen.getByRole("button", { name: /save plan/i }));

    await waitFor(() => expect(platformApi.updatePlan).toHaveBeenCalled());
    expect(vi.mocked(platformApi.updatePlan).mock.calls[0][1].limits)
      .not.toHaveProperty("max_assets");
  });

  it("sends a limit the operator did type", async () => {
    vi.mocked(platformApi.updatePlan).mockResolvedValue(PLANS[0]);
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /edit Starter/i }));
    const assets = screen.getByLabelText(/assets/i);
    await userEvent.clear(assets);
    await userEvent.type(assets, "900");
    await userEvent.click(screen.getByRole("button", { name: /save plan/i }));

    await waitFor(() => expect(platformApi.updatePlan).toHaveBeenCalled());
    expect(vi.mocked(platformApi.updatePlan).mock.calls[0][1].limits)
      .toMatchObject({ max_assets: 900 });
  });

  it("repeats what the server said when a save is refused", async () => {
    vi.mocked(platformApi.updatePlan).mockRejectedValue(
      new ApiError(422, {
        type: "validation", title: "Validation failed",
        detail: "No such feature: telepathy.", status: 422,
      }),
    );
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /edit Starter/i }));
    await userEvent.click(screen.getByRole("button", { name: /save plan/i }));

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("No such feature: telepathy.");
  });

  it("reloads the list after a save, so the list is not stale", async () => {
    vi.mocked(platformApi.updatePlan).mockResolvedValue(PLANS[0]);
    renderPage();
    await waitFor(() => expect(platformApi.plans).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole("button", { name: /edit Starter/i }));
    await userEvent.click(screen.getByRole("button", { name: /save plan/i }));

    await waitFor(() => expect(platformApi.plans).toHaveBeenCalledTimes(2));
  });
});

describe("creating a plan", () => {
  it("asks for a code, and sends what was typed", async () => {
    vi.mocked(platformApi.createPlan).mockResolvedValue(PLANS[0]);
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /new plan/i }));
    await userEvent.type(screen.getByLabelText(/code/i), "campaign");
    await userEvent.type(screen.getByLabelText(/^name$/i), "Campaign");
    const price = screen.getByLabelText(/price/i);
    await userEvent.clear(price);
    await userEvent.type(price, "125000");
    await userEvent.click(screen.getByRole("button", { name: /save plan/i }));

    await waitFor(() => expect(platformApi.createPlan).toHaveBeenCalled());
    expect(vi.mocked(platformApi.createPlan).mock.calls[0][0]).toMatchObject({
      code: "campaign", name: "Campaign", price_minor: 125_000,
    });
  });

  it("includes the register in a new plan without being asked", async () => {
    vi.mocked(platformApi.createPlan).mockResolvedValue(PLANS[0]);
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /new plan/i }));
    await userEvent.type(screen.getByLabelText(/code/i), "campaign");
    await userEvent.type(screen.getByLabelText(/^name$/i), "Campaign");
    await userEvent.click(screen.getByRole("button", { name: /save plan/i }));

    await waitFor(() => expect(platformApi.createPlan).toHaveBeenCalled());
    expect(vi.mocked(platformApi.createPlan).mock.calls[0][0].features)
      .toContain("core");
  });

  it("lets the code be typed, unlike on an existing plan", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /new plan/i }));
    expect(screen.getByLabelText(/code/i)).toBeEnabled();
  });
});

describe("removing a plan", () => {
  it("explains, in the words of the server, why one in use cannot go", async () => {
    // The next move is to move those customers, and the message is what says so.
    vi.mocked(platformApi.deletePlan).mockRejectedValue(
      new ApiError(409, {
        type: "conflict", title: "Plan is in use", status: 409,
        detail: "2 organisations are on starter. Move them first.",
      }),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /edit Starter/i }));
    await userEvent.click(screen.getByRole("button", { name: /delete plan/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Move them first/);
  });

  it("does nothing at all if the confirmation is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: /edit Starter/i }));
    await userEvent.click(screen.getByRole("button", { name: /delete plan/i }));

    expect(platformApi.deletePlan).not.toHaveBeenCalled();
  });

  it("offers deactivating instead, which is safe while customers are on it", async () => {
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: /edit Starter/i }));
    expect(screen.getByRole("checkbox", { name: /offered to new customers/i }))
      .toBeChecked();
  });
});
