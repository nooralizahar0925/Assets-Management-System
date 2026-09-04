import { Link } from "react-router";
import { useAuth } from "../../context/AuthContext";

interface Props {
  /** True when filters are active, so nothing matching is not the same as nothing at all. */
  filtered: boolean;
  onClear: () => void;
}

/**
 * An empty table is a dead end. Which emptiness this is matters: a register with
 * no assets needs a way to add some, while a filter that matched nothing needs a
 * way back - telling a new customer to "clear filters" they never set would be
 * useless, and telling someone mid-search to "import a spreadsheet" more so.
 */
export default function EmptyRegister({ filtered, onClear }: Props) {
  const { can } = useAuth();

  if (filtered) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
          Nothing matches those filters
        </h3>
        <p className="max-w-md text-sm text-gray-500 dark:text-gray-400">
          There are assets in the register, but none match what you have selected.
        </p>
        <button
          type="button"
          onClick={onClear}
          className="mt-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
        >
          Clear filters
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <h3 className="text-base font-semibold text-gray-800 dark:text-white/90">
        No assets yet
      </h3>
      <p className="max-w-md text-sm text-gray-500 dark:text-gray-400">
        Import the spreadsheet you keep today, or add your first asset by hand.
        Most people start with an import.
      </p>
      {(can("assets:import") || can("assets:write")) && (
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {can("assets:import") && (
            <Link
              to="/import"
              className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
            >
              Import a spreadsheet
            </Link>
          )}
          {can("assets:write") && (
            <Link
              to="/assets/new"
              className="rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Add an asset
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
