import { useState } from "react";
import PageMeta from "../components/common/PageMeta";
import Field from "./Field";
import { usePlatformAuth } from "./PlatformAuthContext";
import { ApiError } from "../api/client";

/**
 * The console's front door.
 *
 * Visibly not the customers' sign-in: whoever lands here by accident should
 * know immediately that this is the wrong door, and whoever belongs here
 * should be reminded what these credentials reach.
 */
export default function PlatformSignIn() {
  const { signIn } = usePlatformAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      // One message, whatever went wrong. The API answers the same way for a
      // wrong password, an unknown address and a disabled account, and saying
      // more here would undo that.
      setError(
        err instanceof ApiError && err.status === 429
          ? "Too many attempts. Wait a moment and try again."
          : "That email address and password do not match an operator account.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageMeta title="Operator sign-in" description="Manage customer organisations" />

      <div className="flex min-h-screen items-center justify-center bg-gray-900 px-4">
        <div className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-800 p-8">
          <p className="text-theme-xs font-semibold uppercase tracking-widest text-brand-400">
            Platform console
          </p>
          <h1 className="mt-1 text-title-sm font-bold text-white">
            Operator sign-in
          </h1>
          <p className="mt-2 text-sm text-gray-400">
            This manages customer organisations, their plans and their access.
            If you are looking for your own asset register, it is at{" "}
            <a href="/signin" className="text-brand-400 hover:text-brand-300">
              the ordinary sign-in
            </a>
            .
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <Field
              id="operator-email"
              label="Email"
              value={email}
              onChange={setEmail}
              autoComplete="username"
              placeholder="you@example.com"
            />

            <Field
              id="operator-password"
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
            />

            {error && (
              <div
                role="alert"
                className="rounded-lg border border-error-500 bg-error-500/10 px-3 py-2 text-sm text-error-400"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy || !email.trim() || !password}
              className="h-11 w-full rounded-lg bg-brand-500 text-sm font-medium text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
