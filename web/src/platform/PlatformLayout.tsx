import { NavLink, Outlet } from "react-router";
import PageMeta from "../components/common/PageMeta";
import { usePlatformAuth } from "./PlatformAuthContext";
import PlatformSignIn from "./PlatformSignIn";

/**
 * The console's shell, and its guard.
 *
 * Guarded here rather than by RequireAuth: that one redirects to the
 * customers' sign-in, which is the wrong door for an operator and would put
 * the two planes one redirect apart. Somebody not signed in as an operator
 * simply gets the operator sign-in, in place, with no redirect to follow.
 */

const PAGES = [
  { to: "/platform", label: "Needs attention", end: true },
  { to: "/platform/customers", label: "Customers" },
];

export default function PlatformLayout() {
  const { operator, loading, signOut } = usePlatformAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-900">
        <p className="text-sm text-gray-400">Checking your session…</p>
      </div>
    );
  }

  if (!operator) return <PlatformSignIn />;

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      <PageMeta title="Platform console" description="Manage customer organisations" />

      <header className="border-b border-gray-800">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-6 py-4">
          <div>
            <p className="text-theme-xs font-semibold uppercase tracking-widest text-brand-400">
              Platform console
            </p>
            <p className="text-sm text-gray-400">
              Every customer on this deployment
            </p>
          </div>

          <nav aria-label="Console" className="ml-6 flex gap-1">
            {PAGES.map((page) => (
              <NavLink
                key={page.to}
                to={page.to}
                end={page.end}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 text-sm transition ${
                    isActive
                      ? "bg-brand-500/15 font-medium text-brand-300"
                      : "text-gray-400 hover:bg-white/5 hover:text-gray-200"
                  }`
                }
              >
                {page.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <span className="text-theme-xs text-gray-400">{operator.email}</span>
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-lg px-3 py-2 text-theme-xs font-medium text-gray-300 ring-1 ring-inset ring-gray-700 hover:bg-white/5"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
