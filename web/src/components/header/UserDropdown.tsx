import { useState } from "react";
import { useNavigate } from "react-router";
import { Dropdown } from "../ui/dropdown/Dropdown";
import { useAuth } from "../../context/AuthContext";

/** Two initials from a name, for the avatar circle. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

export default function UserDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  if (!user) return null;

  async function onSignOut() {
    setSigningOut(true);
    try {
      // The previous menu linked straight to /signin, which left the session
      // cookie in place: it looked like signing out without being one.
      await signOut();
      navigate("/signin", { replace: true });
    } finally {
      setSigningOut(false);
      setIsOpen(false);
    }
  }

  const scope =
    user.location_scope === null
      ? "Whole organisation"
      : `${user.location_scope.length} branch${user.location_scope.length === 1 ? "" : "es"}`;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.03]"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-500 text-theme-xs font-medium text-white">
          {initials(user.name)}
        </span>
        <span className="hidden text-sm font-medium sm:block">{user.name}</span>
        <svg
          className={`stroke-gray-500 transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
          width="18" height="20" viewBox="0 0 18 20" fill="none" aria-hidden
        >
          <path
            d="M4.3125 8.65625L9 13.3437L13.6875 8.65625"
            strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
          />
        </svg>
      </button>

      <Dropdown
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        className="absolute right-0 mt-[17px] flex w-[260px] flex-col rounded-2xl border border-gray-200 bg-white p-3 shadow-theme-lg dark:border-gray-800 dark:bg-gray-dark"
      >
        <div className="border-b border-gray-200 pb-3 dark:border-gray-800">
          <span className="block text-sm font-medium text-gray-700 dark:text-gray-400">
            {user.name}
          </span>
          <span className="mt-0.5 block text-theme-xs text-gray-500 dark:text-gray-400">
            {scope} · {user.permissions.length} permission
            {user.permissions.length === 1 ? "" : "s"}
          </span>
        </div>

        <button
          type="button"
          onClick={() => void onSignOut()}
          disabled={signingOut}
          className="mt-3 flex items-center gap-3 rounded-lg px-3 py-2 text-left text-theme-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-white/5"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden
               className="stroke-gray-500 dark:stroke-gray-400">
            <path
              d="M15 12H4m0 0 3.5-3.5M4 12l3.5 3.5M9 7V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-2"
              strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
            />
          </svg>
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </Dropdown>
    </div>
  );
}
