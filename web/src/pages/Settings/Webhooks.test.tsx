import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderPage } from "../../test/render";
import Webhooks from "./Webhooks";

vi.mock("../../api/webhooks", () => ({
  webhooksApi: { list: vi.fn(), create: vi.fn(), remove: vi.fn() },
}));

const canMock = vi.fn(() => true);
vi.mock("../../context/AuthContext", async () => {
  const actual = await vi.importActual<typeof import("../../context/AuthContext")>(
    "../../context/AuthContext",
  );
  return { ...actual, useAuth: () => ({ can: canMock }) };
});

const { webhooksApi } = await import("../../api/webhooks");

const LIST = {
  data: [
    {
      id: "h1", url: "https://example.com/hooks/ams",
      events: ["asset.checked_out"], active: true,
      created_at: "2026-09-01T00:00:00Z",
    },
  ],
  events: ["asset.checked_out", "import.completed"],
};

beforeEach(() => {
  vi.clearAllMocks();
  canMock.mockReturnValue(true);
  vi.mocked(webhooksApi.list).mockResolvedValue(LIST);
  vi.mocked(webhooksApi.create).mockResolvedValue({
    id: "h2", url: "https://example.com/new", events: ["import.completed"],
    active: true, created_at: "2026-09-07T00:00:00Z", secret: "whsec_abc123",
  });
});

describe("the webhooks settings page", () => {
  it("offers the events the server publishes, not a hard-coded list", async () => {
    // Repeating the list here would mean a newly published event needs a web
    // release before anyone can subscribe to it.
    renderPage(<Webhooks />);
    expect(await screen.findByRole("button", { name: "import.completed" }))
      .toBeInTheDocument();
  });

  it("lists what is already subscribed", async () => {
    renderPage(<Webhooks />);
    expect(await screen.findByText("https://example.com/hooks/ams")).toBeInTheDocument();
  });

  it("will not subscribe an endpoint with no events selected", async () => {
    renderPage(<Webhooks />);
    await screen.findByRole("button", { name: "import.completed" });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/endpoint url/i), "https://example.com/new");
    expect(screen.getByRole("button", { name: /^subscribe$/i })).toBeDisabled();
  });

  it("subscribes and shows the secret exactly once", async () => {
    renderPage(<Webhooks />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/endpoint url/i), "https://example.com/new");
    await user.click(await screen.findByRole("button", { name: "import.completed" }));
    await user.click(screen.getByRole("button", { name: /^subscribe$/i }));

    await waitFor(() => expect(webhooksApi.create).toHaveBeenCalledWith(
      "https://example.com/new", ["import.completed"],
    ));
    expect(await screen.findByText("whsec_abc123")).toBeInTheDocument();
    expect(screen.getByText(/will not be shown again/i)).toBeInTheDocument();
  });

  it("reports why the server refused rather than failing silently", async () => {
    const { ApiError } = await import("../../api/client");
    vi.mocked(webhooksApi.create).mockRejectedValue(new ApiError(422, {
      type: "validation", status: 422, title: "Validation failed",
      detail: "Only http and https endpoints are supported.",
    }));

    renderPage(<Webhooks />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/endpoint url/i), "ftp://example.com");
    await user.click(await screen.findByRole("button", { name: "import.completed" }));
    await user.click(screen.getByRole("button", { name: /^subscribe$/i }));

    expect(await screen.findByRole("alert"))
      .toHaveTextContent(/only http and https/i);
  });

  it("does not show the form to somebody who cannot manage webhooks", async () => {
    canMock.mockReturnValue(false);
    renderPage(<Webhooks />);
    expect(screen.getByRole("alert")).toHaveTextContent(/managed by an administrator/i);
    expect(webhooksApi.list).not.toHaveBeenCalled();
  });
});
