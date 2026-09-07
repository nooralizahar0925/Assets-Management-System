import { useEffect, useState } from "react";
import { developersApi, type CatalogError } from "../../api/developers";
import Prose from "../../components/developers/Prose";
import CodeBlock from "../../components/developers/CodeBlock";

/**
 * The error catalogue, read from the server.
 *
 * The API's own test suite scans the source for every `problem(...)` slug and
 * fails when the catalogue disagrees, so this page cannot quietly go stale:
 * adding an error the documentation does not describe breaks the build.
 */
export default function Errors() {
  const [entries, setEntries] = useState<CatalogError[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    developersApi
      .errors()
      .then((rows) => { if (live) setEntries(rows); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);

  return (
    <div>
      <Prose>
        <h1 className="text-title-sm font-bold text-gray-800 dark:text-white/90">
          Errors
        </h1>
        <p>
          Every failure is a problem document. Branch on <code>type</code> — it
          is stable. The status code is not specific enough to act on and the
          title is prose that may be reworded.
        </p>
        <CodeBlock
          label="A validation failure"
          code={`{
  "type": "https://ams.dev/errors/validation",
  "title": "Validation failed",
  "status": 422,
  "detail": "The request body did not satisfy the schema.",
  "errors": [ { "field": "purchase_cost", "message": "must not be negative" } ]
}`}
        />
      </Prose>

      {failed && (
        <p className="rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-theme-sm text-warning-700 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-400">
          The catalogue could not be loaded.
        </p>
      )}

      <ul className="mt-6 space-y-4">
        {entries.map((entry) => (
          <li
            key={entry.slug}
            className="rounded-xl border border-gray-200 p-4 dark:border-gray-800"
          >
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="rounded-md bg-gray-100 px-2 py-1 text-theme-xs font-semibold text-gray-700 dark:bg-white/10 dark:text-gray-300">
                {entry.status}
              </span>
              <h2 className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">
                {entry.title}
              </h2>
              <code className="text-theme-xs text-gray-400">{entry.type}</code>
            </div>
            <p className="mt-2 text-theme-sm text-gray-600 dark:text-gray-400">
              {entry.when}
            </p>
            <p className="mt-2 text-theme-sm text-gray-800 dark:text-gray-200">
              <span className="font-medium">What to do: </span>
              {entry.fix}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
