import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router";
import { AuthProvider } from "../../context/AuthContext";
import SignInForm from "./SignInForm";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });

const renderForm = (initial = "/signin") =>
  render(
    <MemoryRouter initialEntries={[initial]}>
      <AuthProvider>
        <Routes>
          <Route path="/signin" element={<SignInForm />} />
          <Route path="/" element={<p>dashboard</p>} />
          <Route path="/assets" element={<p>the register</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );

const fillAndSubmit = async (email = "rina@example.com", password = "pw") => {
  await userEvent.type(screen.getByLabelText(/email/i), email);
  await userEvent.type(screen.getByLabelText(/^password/i), password);
  await userEvent.click(screen.getByRole("button", { name: /^sign in$/i }));
};

beforeEach(() => {
  vi.restoreAllMocks();
  // The initial /me probe the provider makes on mount.
  vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ title: "Unauthorized" }, 401));
});

afterEach(() => vi.restoreAllMocks());

describe("SignInForm", () => {
  it("signs in and lands on the dashboard", async () => {
    renderForm();
    await waitFor(() => expect(screen.getByLabelText(/email/i)).toBeInTheDocument());

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({ id: "u1", name: "Rina", role: "admin", org_id: "o1" }),
    );
    await fillAndSubmit();

    await waitFor(() => expect(screen.getByText("dashboard")).toBeInTheDocument());
  });

  it("shows one message for both a wrong password and an unknown account", async () => {
    // The API refuses to distinguish them; the form must not either, or it
    // reintroduces the account-enumeration the API was careful to avoid.
    renderForm();
    await waitFor(() => expect(screen.getByLabelText(/email/i)).toBeInTheDocument());

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({ title: "Authentication required", status: 401 }, 401),
    );
    await fillAndSubmit();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/do not match/i);
    expect(alert).not.toHaveTextContent(/unknown|no such|not found/i);
  });

  it("explains a rate limit differently, because waiting is the fix", async () => {
    renderForm();
    await waitFor(() => expect(screen.getByLabelText(/email/i)).toBeInTheDocument());

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({ title: "Too many sign-in attempts", status: 429 }, 429),
    );
    await fillAndSubmit();

    expect(await screen.findByRole("alert")).toHaveTextContent(/wait a few minutes/i);
  });

  it("toggles password visibility", async () => {
    renderForm();
    await waitFor(() => expect(screen.getByLabelText(/^password/i)).toBeInTheDocument());

    const field = screen.getByLabelText(/^password/i);
    expect(field).toHaveAttribute("type", "password");
    await userEvent.click(screen.getByRole("button", { name: /show password/i }));
    expect(field).toHaveAttribute("type", "text");
  });

  it("disables the button while the request is in flight", async () => {
    renderForm();
    await waitFor(() => expect(screen.getByLabelText(/email/i)).toBeInTheDocument());

    let release: (value: Response) => void = () => {};
    vi.spyOn(globalThis, "fetch").mockReturnValue(
      new Promise<Response>((resolve) => { release = resolve; }),
    );
    await fillAndSubmit();

    expect(screen.getByRole("button", { name: /signing in/i })).toBeDisabled();
    release(json({ id: "u1", name: "Rina", role: "admin", org_id: "o1" }));
  });
});
