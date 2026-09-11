import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { AppWrapper } from "../components/common/PageMeta";
import NewOrganisation from "./NewOrganisation";

vi.mock("../api/platform", () => ({
  platformApi: { plans: vi.fn(), provision: vi.fn() },
}));

const { platformApi } = await import("../api/platform");
const { ApiError } = await import("../api/client");

const renderPage = () =>
  render(
    <AppWrapper><MemoryRouter><NewOrganisation /></MemoryRouter></AppWrapper>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(platformApi.plans).mockResolvedValue({
    data: [
      {
        code: "starter", name: "Starter", description: "", price_minor: 250_000,
        currency: "IDR", billing_cycle: "monthly", features: ["core"],
        limits: {}, active: true, sort_order: 1,
      },
      {
        code: "retired", name: "Retired plan", description: "", price_minor: 0,
        currency: "IDR", billing_cycle: "monthly", features: ["core"],
        limits: {}, active: false, sort_order: 9,
      },
    ],
    features: [],
  });
  vi.mocked(platformApi.provision).mockResolvedValue({
    orgId: "o1", slug: "acme-ltd",
    adminEmail: "ayu@acme.example", password: "a-generated-password",
  });
});

describe("taking on a customer", () => {
  it("suggests a slug from the name", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/organisation name/i), "Acme Ltd");
    expect(screen.getByLabelText(/^slug$/i)).toHaveValue("acme-ltd");
  });

  it("stops suggesting once the operator types one", async () => {
    // Silently rewriting something somebody has typed is worse than a
    // suggestion that stops being helpful.
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/organisation name/i), "Acme");
    await user.clear(screen.getByLabelText(/^slug$/i));
    await user.type(screen.getByLabelText(/^slug$/i), "acme-jakarta");
    await user.type(screen.getByLabelText(/organisation name/i), " Ltd");

    expect(screen.getByLabelText(/^slug$/i)).toHaveValue("acme-jakarta");
  });

  it("offers only plans that are still sold", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole("option", { name: "Starter" }))
      .toBeInTheDocument());
    expect(screen.queryByRole("option", { name: "Retired plan" }))
      .not.toBeInTheDocument();
  });

  it("allows a customer with no plan yet", async () => {
    // One still being arranged. They get the register and nothing that is sold.
    renderPage();
    await waitFor(() => expect(screen.getByRole("option", { name: /no plan yet/i }))
      .toBeInTheDocument());
  });

  it("will not submit until it has what it needs", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByRole("button", { name: /create customer/i })).toBeDisabled();
    await user.type(screen.getByLabelText(/organisation name/i), "Acme Ltd");
    expect(screen.getByRole("button", { name: /create customer/i })).toBeDisabled();
  });

  it("sends what was typed", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/organisation name/i), "Acme Ltd");
    await user.type(screen.getByLabelText(/their administrator/i), "Ayu Lestari");
    await user.type(screen.getByLabelText(/their email/i), "ayu@acme.example");
    await user.type(screen.getByLabelText(/trial days/i), "30");
    await user.click(screen.getByRole("button", { name: /create customer/i }));

    await waitFor(() => expect(platformApi.provision).toHaveBeenCalledWith({
      name: "Acme Ltd",
      slug: "acme-ltd",
      adminName: "Ayu Lestari",
      adminEmail: "ayu@acme.example",
      planCode: null,
      trialDays: 30,
    }));
  });

  it("shows the password once, on a page of its own", async () => {
    // Not a toast: a stray click would dismiss the only copy of a credential
    // before anybody had written it down.
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/organisation name/i), "Acme Ltd");
    await user.type(screen.getByLabelText(/their administrator/i), "Ayu");
    await user.type(screen.getByLabelText(/their email/i), "ayu@acme.example");
    await user.click(screen.getByRole("button", { name: /create customer/i }));

    expect(await screen.findByText("a-generated-password")).toBeInTheDocument();
    expect(screen.getByText(/shown here once/i)).toBeInTheDocument();
    expect(screen.getByText("ayu@acme.example")).toBeInTheDocument();
  });

  it("says why a slug was refused, rather than failing silently", async () => {
    vi.mocked(platformApi.provision).mockRejectedValue(new ApiError(409, {
      type: "conflict", status: 409, title: "Slug already in use",
      detail: 'The slug "acme-ltd" is already in use.',
    }));

    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/organisation name/i), "Acme Ltd");
    await user.type(screen.getByLabelText(/their administrator/i), "Ayu");
    await user.type(screen.getByLabelText(/their email/i), "ayu@acme.example");
    await user.click(screen.getByRole("button", { name: /create customer/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/already in use/i);
  });

  it("keeps the typed details when the server refuses", async () => {
    // Losing a form somebody has just filled in, because a slug clashed, is
    // the sort of thing that makes an operator dread the screen.
    vi.mocked(platformApi.provision).mockRejectedValue(new ApiError(409, {
      type: "conflict", status: 409, title: "Slug already in use",
      detail: "Already in use.",
    }));

    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/organisation name/i), "Acme Ltd");
    await user.type(screen.getByLabelText(/their administrator/i), "Ayu");
    await user.type(screen.getByLabelText(/their email/i), "ayu@acme.example");
    await user.click(screen.getByRole("button", { name: /create customer/i }));

    await screen.findByRole("alert");
    expect(screen.getByLabelText(/organisation name/i)).toHaveValue("Acme Ltd");
    expect(screen.getByLabelText(/their email/i)).toHaveValue("ayu@acme.example");
  });
});
