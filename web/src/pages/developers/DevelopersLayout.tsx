import { NavLink, Outlet, Link } from "react-router";
import PageMeta from "../../components/common/PageMeta";

/**
 * The developer portal's shell.
 *
 * Public on purpose: an integrator reads these pages to decide whether to build
 * against the API, which is before anyone has issued them a credential. Nothing
 * here calls a tenant-scoped endpoint.
 */

const PAGES = [
  { to: "/developers", label: "Overview", end: true },
  { to: "/developers/authentication", label: "Authentication" },
  { to: "/developers/conventions", label: "Conventions" },
  { to: "/developers/recipes", label: "Recipes" },
  { to: "/developers/reference", label: "API reference" },
  { to: "/developers/webhooks", label: "Webhooks" },
  { to: "/developers/errors", label: "Errors" },
  { to: "/developers/changelog", label: "Changelog" },
];

export default function DevelopersLayout() {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      <PageMeta
        title="Developers | AMS"
        description="Build against the Assets Management System API"
      />

      <header className="border-b border-gray-200 dark:border-gray-800">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-4">
          <Link to="/developers" className="flex items-center gap-3">
            <img src="/images/logo/mark.svg" alt="" width={28} height={28} />
            <span className="text-sm font-semibold text-gray-800 dark:text-white/90">
              Assets Management System
              <span className="ml-2 font-normal text-gray-500 dark:text-gray-400">
                for developers
              </span>
            </span>
          </Link>
          <Link
            to="/"
            className="ml-auto text-theme-xs font-medium text-brand-500 hover:text-brand-600"
          >
            Open the application
          </Link>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-10 px-6 py-8">
        <nav aria-label="Developer documentation" className="w-48 shrink-0">
          <ul className="sticky top-8 space-y-1">
            {PAGES.map((page) => (
              <li key={page.to}>
                <NavLink
                  to={page.to}
                  end={page.end}
                  className={({ isActive }) =>
                    `block rounded-lg px-3 py-2 text-sm transition ${
                      isActive
                        ? "bg-brand-50 font-medium text-brand-600 dark:bg-brand-500/10 dark:text-brand-400"
                        : "text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.03]"
                    }`
                  }
                >
                  {page.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
