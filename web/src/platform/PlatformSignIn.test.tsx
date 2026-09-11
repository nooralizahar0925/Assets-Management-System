import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router";
import { AppWrapper } from "../components/common/PageMeta";
import { PlatformAuthProvider } from "./PlatformAuthContext";
import PlatformLayout from "./PlatformLayout";

vi.mock("../api/platform", () => ({
  platformApi: {
    me: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), organisations: vi.fn(),
  },
}));

const { platformApi } = await import("../api/platform");
const { ApiError } = await import("../api/client");

const OPERATOR = { id: "p1", email: "ops@example.com", name: "Noor" };

const renderConsole = () =>
  render(
    <AppWrapper>
      <MemoryRouter initialEntries={["/platform"]}>
        <PlatformAuthProvider>
          <Routes>
            <Route path="/platform" element={<PlatformLayout />}>
              <Route index element={<p>The customer list</p>} />
            </Route>
          </Routes>
        </PlatformAuthProvider>
      </MemoryRouter>
    </AppWrapper>,
  );

const notSignedIn = () =>
  vi.mocked(platformApi.me).mockRejectedValue(new ApiError(401, {
    type: "unauthorized", status: 401, title: "Authentication required",
  }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(platformApi.organisations).mockResolvedValue({ data: [] });
});

describe("reaching the console", () => {
  it("shows the operator sign-in to somebody who is not signed in", async () => {
    notSignedIn();
    renderConsole();

    expect(await screen.findByRole("heading", { name: /operator sign-in/i }))
      .toBeInTheDocument();
    expect(screen.queryByText("The customer list")).not.toBeInTheDocument();
  });

  it("never sends an operator to the customers' sign-in", async () => {
    // Two planes, two doors. RequireAuth would redirect to /signin, which is
    // the wrong door and would put the two one redirect apart.
    notSignedIn();
    renderConsole();

    await screen.findByRole("heading", { name: /operator sign-in/i });
    const link = screen.getByRole("link", { name: /ordinary sign-in/i });
    // Offered as a way out for somebody at the wrong door, not as a redirect.
    expect(link).toHaveAttribute("href", "/signin");
  });

  it("shows the console once the session resolves", async () => {
    vi.mocked(platformApi.me).mockResolvedValue(OPERATOR);
    renderConsole();

    expect(await screen.findByText("The customer list")).toBeInTheDocument();
    expect(screen.getByText("ops@example.com")).toBeInTheDocument();
  });

  it("says nothing either way while it is still checking", async () => {
    // A flash of the sign-in form for somebody who is signed in reads as
    // having been logged out.
    vi.mocked(platformApi.me).mockReturnValue(new Promise(() => {}));
    renderConsole();

    expect(screen.getByText(/checking your session/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /operator sign-in/i }))
      .not.toBeInTheDocument();
  });
});

describe("signing in as an operator", () => {
  it("sends the credentials and then shows the console", async () => {
    notSignedIn();
    renderConsole();
    await screen.findByRole("heading", { name: /operator sign-in/i });

    vi.mocked(platformApi.signIn).mockResolvedValue(OPERATOR);
    vi.mocked(platformApi.me).mockResolvedValue(OPERATOR);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), "ops@example.com");
    await user.type(screen.getByLabelText(/password/i), "a-real-password");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => expect(platformApi.signIn)
      .toHaveBeenCalledWith("ops@example.com", "a-real-password"));
    expect(await screen.findByText("The customer list")).toBeInTheDocument();
  });

  it("gives one message however the sign-in failed", async () => {
    // The API answers identically for a wrong password, an unknown address
    // and a disabled account. Saying more here would undo that.
    notSignedIn();
    renderConsole();
    await screen.findByRole("heading", { name: /operator sign-in/i });

    vi.mocked(platformApi.signIn).mockRejectedValue(new ApiError(401, {
      type: "unauthorized", status: 401, title: "Authentication required",
    }));

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), "ops@example.com");
    await user.type(screen.getByLabelText(/password/i), "wrong");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(await screen.findByRole("alert"))
      .toHaveTextContent(/do not match an operator account/i);
  });

  it("says plainly when it has been throttled", async () => {
    notSignedIn();
    renderConsole();
    await screen.findByRole("heading", { name: /operator sign-in/i });

    vi.mocked(platformApi.signIn).mockRejectedValue(new ApiError(429, {
      type: "rate-limited", status: 429, title: "Too many attempts",
    }));

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), "ops@example.com");
    await user.type(screen.getByLabelText(/password/i), "wrong-again");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/too many attempts/i);
  });

  it("will not submit an empty form", async () => {
    notSignedIn();
    renderConsole();
    await screen.findByRole("heading", { name: /operator sign-in/i });

    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeDisabled();
  });
});

describe("signing out", () => {
  it("ends the session and returns to the operator sign-in", async () => {
    vi.mocked(platformApi.me).mockResolvedValue(OPERATOR);
    vi.mocked(platformApi.signOut).mockResolvedValue(null);
    renderConsole();
    await screen.findByText("The customer list");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /sign out/i }));

    expect(await screen.findByRole("heading", { name: /operator sign-in/i }))
      .toBeInTheDocument();
    expect(platformApi.signOut).toHaveBeenCalled();
  });
});
