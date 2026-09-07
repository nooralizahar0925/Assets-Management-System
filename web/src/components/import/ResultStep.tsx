import { Link } from "react-router";
import type { ImportResult } from "../../api/imports";

export default function ResultStep({
  result, onAnother,
}: { result: ImportResult; onAnother: () => void }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-50 dark:bg-success-500/15">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M5 13l4 4L19 7" stroke="#10b981" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h3 className="mt-4 text-lg font-medium text-gray-800 dark:text-white/90">
        Import finished
      </h3>
      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
        {result.created.toLocaleString("en-GB")} created ·{" "}
        {result.updated.toLocaleString("en-GB")} updated ·{" "}
        {result.skipped.toLocaleString("en-GB")} skipped
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <Link
          to="/assets"
          className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
        >
          View the register
        </Link>
        <button
          type="button"
          onClick={onAnother}
          className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700"
        >
          Import another file
        </button>
      </div>
    </div>
  );
}
