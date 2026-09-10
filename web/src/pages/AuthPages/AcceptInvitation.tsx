import { useState } from "react";
import { useNavigate, useParams, Link } from "react-router";
import PageMeta from "../../components/common/PageMeta";
import Label from "../../components/form/Label";
import Input from "../../components/form/input/InputField";
import { membersApi } from "../../api/admin";
import { ApiError } from "../../api/client";

/**
 * Where an invitation link lands.
 *
 * Public: whoever holds the link has no account yet, which is the point. They
 * choose their own password here rather than being handed one, so nobody else
 * ever knows it.
 */
export default function AcceptInvitation() {
  const { token = "" } = useParams();
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = password.length >= 8 && confirm === password && !busy;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await membersApi.acceptInvitation(token, password);
      // Signed in already by the API, so straight to the register rather than
      // asking somebody who has just chosen a password to type it again.
      navigate("/");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.problem.detail ?? err.message
          : "That did not work. Ask whoever invited you to send another link.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageMeta title="Accept your invitation | AMS" description="Choose a password" />

      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-900">
        <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 dark:border-gray-800 dark:bg-white/[0.03]">
          <h1 className="text-title-sm font-bold text-gray-800 dark:text-white/90">
            Choose a password
          </h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            You have been invited to an Assets Management System organisation.
            Pick a password and you are in.
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <Label htmlFor="invite-password">Password</Label>
              <Input
                id="invite-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {tooShort && (
                <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">
                  At least 8 characters.
                </p>
              )}
            </div>

            <div>
              <Label htmlFor="invite-confirm">Password again</Label>
              <Input
                id="invite-confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              {mismatch && (
                <p className="mt-1 text-theme-xs text-error-500">
                  These two do not match.
                </p>
              )}
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-lg border border-error-500 bg-error-50 px-3 py-2 text-sm text-error-600 dark:bg-error-500/10"
              >
                {error}
                <p className="mt-1 text-theme-xs">
                  <Link to="/signin" className="underline">
                    Already have an account? Sign in
                  </Link>
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={!ready}
              className="h-11 w-full rounded-lg bg-brand-500 text-sm font-medium text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Setting up…" : "Set password and sign in"}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
