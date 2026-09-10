import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderPage } from "../../test/render";
import AcceptInvitation from "./AcceptInvitation";

vi.mock("../../api/admin", async () => {
  const actual = await vi.importActual<typeof import("../../api/admin")>(
    "../../api/admin",
  );
  return {
    ...actual,
    membersApi: { ...actual.membersApi, acceptInvitation: vi.fn() },
  };
});

const { membersApi } = await import("../../api/admin");

const render = () =>
  renderPage(<AcceptInvitation />, {
    route: "/accept-invitation/a-token-from-the-email",
    path: "/accept-invitation/:token",
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(membersApi.acceptInvitation).mockResolvedValue({
    id: "u1", email: "rina@example.com", org_id: "org-1",
  });
});

describe("accepting an invitation", () => {
  it("asks for a password twice and sends the token from the link", async () => {
    const user = userEvent.setup();
    render();

    await user.type(screen.getByLabelText(/^password$/i), "a-password-they-chose");
    await user.type(screen.getByLabelText(/password again/i), "a-password-they-chose");
    await user.click(screen.getByRole("button", { name: /set password/i }));

    await waitFor(() => expect(membersApi.acceptInvitation).toHaveBeenCalledWith(
      "a-token-from-the-email", "a-password-they-chose",
    ));
  });

  it("will not submit until the two match", async () => {
    const user = userEvent.setup();
    render();

    await user.type(screen.getByLabelText(/^password$/i), "a-password-they-chose");
    await user.type(screen.getByLabelText(/password again/i), "something-else");

    expect(screen.getByRole("button", { name: /set password/i })).toBeDisabled();
    expect(screen.getByText(/do not match/i)).toBeInTheDocument();
  });

  it("will not submit a password too short to be worth having", async () => {
    // Somebody choosing their first password is exactly who should not be
    // allowed a weak one.
    const user = userEvent.setup();
    render();

    await user.type(screen.getByLabelText(/^password$/i), "short");
    expect(screen.getByRole("button", { name: /set password/i })).toBeDisabled();
    expect(screen.getByText(/at least 8/i)).toBeInTheDocument();
  });

  it("explains a link that has expired, and offers the way back", async () => {
    const { ApiError } = await import("../../api/client");
    vi.mocked(membersApi.acceptInvitation).mockRejectedValue(new ApiError(410, {
      type: "invitation-invalid", status: 410, title: "No longer valid",
      detail: "This invitation is not valid any more.",
    }));

    const user = userEvent.setup();
    render();

    await user.type(screen.getByLabelText(/^password$/i), "a-password-they-chose");
    await user.type(screen.getByLabelText(/password again/i), "a-password-they-chose");
    await user.click(screen.getByRole("button", { name: /set password/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/not valid any more/i);
    expect(screen.getByRole("link", { name: /sign in/i })).toBeInTheDocument();
  });
});
