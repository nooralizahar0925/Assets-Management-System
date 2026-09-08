import { useEffect, useState } from "react";
import {
  developersApi, groupByTag,
  type OpenApiDocument, type ReferenceGroup, type ReferenceOperation,
} from "../../api/developers";
import Prose from "../../components/developers/Prose";
import TryIt from "../../components/developers/TryIt";

/**
 * The API reference, rendered from the document the server publishes.
 *
 * Never transcribed. A hand-written reference is wrong the first time an
 * endpoint changes and nobody remembers this page exists; reading
 * `/api/v1/openapi.json` means the reference cannot drift from the contract.
 */

const METHOD_STYLE: Record<string, string> = {
  get: "bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-400",
  post: "bg-blue-light-50 text-blue-light-700 dark:bg-blue-light-500/15 dark:text-blue-light-400",
  put: "bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-400",
  patch: "bg-warning-50 text-warning-700 dark:bg-warning-500/15 dark:text-warning-400",
  delete: "bg-error-50 text-error-700 dark:bg-error-500/15 dark:text-error-400",
};

function Operation({ operation }: { operation: ReferenceOperation }) {
  const [open, setOpen] = useState(false);
  const parameters = operation.parameters ?? [];
  const responses = Object.entries(operation.responses ?? {});

  return (
    <li className="rounded-xl border border-gray-200 dark:border-gray-800">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span
          className={`w-16 shrink-0 rounded-md px-2 py-1 text-center text-theme-xs font-semibold uppercase ${
            METHOD_STYLE[operation.method] ?? "bg-gray-100 text-gray-700"
          }`}
        >
          {operation.method}
        </span>
        <code className="truncate text-theme-sm text-gray-700 dark:text-gray-300">
          {operation.path}
        </code>
        <span className="ml-auto truncate pl-4 text-theme-xs text-gray-500 dark:text-gray-400">
          {operation.summary}
        </span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-gray-200 px-4 py-4 dark:border-gray-800">
          {operation.description && (
            <p className="text-theme-sm text-gray-600 dark:text-gray-400">
              {operation.description}
            </p>
          )}

          {parameters.length > 0 && (
            <div>
              <h4 className="mb-2 text-theme-xs font-semibold uppercase tracking-wide text-gray-500">
                Parameters
              </h4>
              <ul className="space-y-1">
                {parameters.map((parameter) => (
                  <li key={`${parameter.in}:${parameter.name}`} className="text-theme-sm">
                    <code className="text-gray-800 dark:text-gray-200">{parameter.name}</code>
                    <span className="ml-2 text-gray-400">{parameter.in}</span>
                    {parameter.required && (
                      <span className="ml-2 text-error-500">required</span>
                    )}
                    {parameter.description && (
                      <span className="ml-2 text-gray-500 dark:text-gray-400">
                        — {parameter.description}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <h4 className="mb-2 text-theme-xs font-semibold uppercase tracking-wide text-gray-500">
              Responses
            </h4>
            <ul className="space-y-1">
              {responses.map(([status, response]) => (
                <li key={status} className="text-theme-sm">
                  <code className="text-gray-800 dark:text-gray-200">{status}</code>
                  <span className="ml-2 text-gray-500 dark:text-gray-400">
                    {response?.description ?? ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <TryIt
            method={operation.method}
            path={operation.path}
            parameters={parameters}
          />
        </div>
      )}
    </li>
  );
}

export default function Reference() {
  const [doc, setDoc] = useState<OpenApiDocument | null>(null);
  const [groups, setGroups] = useState<ReferenceGroup[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    developersApi
      .openapi()
      .then((document) => {
        if (!live) return;
        setDoc(document);
        setGroups(groupByTag(document));
      })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);

  return (
    <div>
      <Prose>
        <h1 className="text-title-sm font-bold text-gray-800 dark:text-white/90">
          API reference
        </h1>
        <p>
          Generated from the running server, so it cannot drift from what the
          API actually does. The same document is available as{" "}
          <a href="/api/v1/openapi.json">openapi.json</a> — point a client
          generator at it rather than writing request code by hand.
        </p>
        {doc && (
          <p className="text-theme-xs text-gray-500 dark:text-gray-400">
            OpenAPI {doc.openapi} · {doc.info.title} {doc.info.version}
          </p>
        )}
      </Prose>

      {failed && (
        <p className="rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-theme-sm text-warning-700 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-400">
          The API description could not be loaded. It is served by the same
          server as the application, so this usually means the API is down —
          try <a className="underline" href="/api/v1/openapi.json">the raw
          document</a> to confirm.
        </p>
      )}

      {groups.map((group) => (
        <section key={group.name} className="mt-8">
          <h2 className="text-theme-lg font-semibold text-gray-800 dark:text-white/90">
            {group.name}
          </h2>
          {group.description && (
            <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">
              {group.description}
            </p>
          )}
          <ul className="mt-3 space-y-2">
            {group.operations.map((operation) => (
              <Operation key={`${operation.method} ${operation.path}`} operation={operation} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
