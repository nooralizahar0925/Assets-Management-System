import type { ImportResult } from "../../api/imports";

function Stat({ label, value, tone }: { label: string; value: number; tone?: "error" }) {
  return (
    <div className="rounded-xl border border-gray-200 p-4 text-center dark:border-gray-800">
      <p className={`text-title-sm font-bold ${
        tone === "error" ? "text-error-500" : "text-gray-800 dark:text-white/90"
      }`}>
        {value.toLocaleString("en-GB")}
      </p>
      <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">{label}</p>
    </div>
  );
}

interface Props {
  result: ImportResult;
  committing: boolean;
  onCommit: () => void;
  onBack: () => void;
}

export default function PreviewStep({ result, committing, onCommit, onBack }: Props) {
  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-blue-light-50 px-4 py-3 text-sm text-blue-light-600 dark:bg-blue-light-500/10">
        This was a dry run — <strong>nothing has been saved yet</strong>. Review the
        numbers below, then confirm.
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Rows in file" value={result.total} />
        <Stat label="Will be created" value={result.created} />
        <Stat label="Will be updated" value={result.updated} />
        <Stat
          label="Will be skipped" value={result.skipped}
          tone={result.skipped > 0 ? "error" : undefined}
        />
      </div>

      {result.errors.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-error-500/40">
          <div className="bg-error-50 px-5 py-3 text-sm font-medium text-error-600 dark:bg-error-500/10">
            {result.errors.length} row{result.errors.length === 1 ? "" : "s"} cannot be
            imported. Fix them in the file, or continue and import the rest.
          </div>
          <ul className="max-h-64 divide-y divide-gray-100 overflow-y-auto dark:divide-gray-800">
            {result.errors.slice(0, 100).map((error, index) => (
              <li key={index} className="px-5 py-2.5 text-sm text-gray-700 dark:text-gray-300">
                <span className="font-mono text-theme-xs text-gray-400">
                  Row {error.row}
                </span>{" "}
                — <strong>{error.field}</strong>: {error.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onCommit}
          disabled={committing || result.created + result.updated === 0}
          className="rounded-lg bg-brand-500 px-5 py-3.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {committing
            ? "Importing…"
            : `Import ${(result.created + result.updated).toLocaleString("en-GB")} assets`}
        </button>
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg px-5 py-3.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700"
        >
          Back to mapping
        </button>
      </div>
    </div>
  );
}
