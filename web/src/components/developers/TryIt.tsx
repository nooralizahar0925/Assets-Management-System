import { useState } from "react";
import CodeBlock from "./CodeBlock";

/**
 * Sends one real request to this deployment's API and shows what came back.
 *
 * The plan called for Scalar's request runner; its React package does not
 * exist and the surviving one costs 40 MB and the Vue runtime. This is the
 * part that was actually wanted: fill in the parameters, paste a key, see the
 * response. It is deliberately small.
 *
 * Two constraints it keeps. The URL is built from the operation, never typed,
 * so this cannot be pointed at another host - it is not a proxy, and a public
 * page that will send an arbitrary request anywhere is an open redirect with
 * extra steps. And the key is held in component state only: never stored,
 * never logged, gone when the page is closed.
 */

interface Parameter {
  name: string;
  in: string;
  required?: boolean;
}

interface Props {
  method: string;
  path: string;
  parameters: Parameter[];
}

interface Result {
  status: number;
  statusText: string;
  body: string;
  requestId: string | null;
  ms: number;
}

const WRITES = new Set(["post", "put", "patch", "delete"]);

/** Fills `{id}` placeholders and appends the query parameters that were given. */
export function buildUrl(
  path: string,
  parameters: Parameter[],
  values: Record<string, string>,
): string {
  let url = path;
  for (const parameter of parameters.filter((p) => p.in === "path")) {
    url = url.replace(`{${parameter.name}}`, encodeURIComponent(values[parameter.name] ?? ""));
  }

  const query = new URLSearchParams();
  for (const parameter of parameters.filter((p) => p.in === "query")) {
    const value = values[parameter.name];
    if (value) query.set(parameter.name, value);
  }

  const search = query.toString();
  return search ? `${url}?${search}` : url;
}

export default function TryIt({ method, path, parameters }: Props) {
  const [apiKey, setApiKey] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [body, setBody] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const isWrite = WRITES.has(method);
  const url = buildUrl(path, parameters, values);
  const missing = parameters
    .filter((p) => p.in === "path" && !values[p.name]?.trim())
    .map((p) => p.name);

  async function send() {
    setError(null);
    setResult(null);

    if (isWrite && !window.confirm(
      `This sends a real ${method.toUpperCase()} to ${url} and changes data in `
      + "whichever organisation the key belongs to. Continue?",
    )) return;

    setSending(true);
    const started = performance.now();
    try {
      const response = await fetch(url, {
        method: method.toUpperCase(),
        headers: {
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          ...(body.trim() ? { "content-type": "application/json" } : {}),
        },
        body: body.trim() || undefined,
      });

      const text = await response.text();
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // Not JSON - a download, or an error page. Show it as it arrived.
      }

      setResult({
        status: response.status,
        statusText: response.statusText,
        body: pretty.slice(0, 20_000),
        requestId: response.headers.get("x-request-id"),
        ms: Math.round(performance.now() - started),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The request could not be sent.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
      <h4 className="text-theme-xs font-semibold uppercase tracking-wide text-gray-500">
        Try it
      </h4>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-theme-xs text-gray-600 dark:text-gray-400">
          API key
          <input
            type="password"
            value={apiKey}
            autoComplete="off"
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="ams_live_…"
            className="mt-1 h-9 w-full rounded-md border border-gray-300 px-2 text-theme-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
          />
        </label>

        {parameters.filter((p) => p.in === "path" || p.in === "query").map((parameter) => (
          <label
            key={`${parameter.in}:${parameter.name}`}
            className="text-theme-xs text-gray-600 dark:text-gray-400"
          >
            {parameter.name}
            {parameter.in === "path" && <span className="text-error-500"> *</span>}
            <input
              type="text"
              value={values[parameter.name] ?? ""}
              onChange={(event) =>
                setValues((current) => ({
                  ...current, [parameter.name]: event.target.value,
                }))
              }
              className="mt-1 h-9 w-full rounded-md border border-gray-300 px-2 text-theme-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
            />
          </label>
        ))}
      </div>

      {isWrite && (
        <label className="mt-3 block text-theme-xs text-gray-600 dark:text-gray-400">
          Request body (JSON)
          <textarea
            value={body}
            rows={4}
            onChange={(event) => setBody(event.target.value)}
            placeholder={'{\n  "name": "ThinkPad T14"\n}'}
            className="mt-1 w-full rounded-md border border-gray-300 p-2 font-mono text-theme-xs text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
          />
        </label>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || missing.length > 0}
          className="rounded-lg bg-brand-500 px-3 py-2 text-theme-xs font-medium text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? "Sending…" : `Send ${method.toUpperCase()}`}
        </button>
        <code className="truncate text-theme-xs text-gray-500 dark:text-gray-400">
          {url}
        </code>
      </div>

      {missing.length > 0 && (
        <p className="mt-2 text-theme-xs text-gray-500 dark:text-gray-400">
          Fill in {missing.join(", ")} to send this one.
        </p>
      )}

      <p className="mt-2 text-theme-xs text-gray-400">
        The key is used for this request and nothing else — it is never stored,
        and it goes only to this deployment.
      </p>

      {error && (
        <p role="alert" className="mt-3 text-theme-xs text-error-500">{error}</p>
      )}

      {result && (
        <div className="mt-3">
          <p className="text-theme-xs text-gray-600 dark:text-gray-400">
            <span
              className={
                result.status < 400 ? "font-semibold text-success-600"
                  : "font-semibold text-error-500"
              }
            >
              {result.status} {result.statusText}
            </span>
            {" · "}{result.ms} ms
            {result.requestId && (
              <>
                {" · "}
                <span className="text-gray-400">
                  request {result.requestId}
                </span>
              </>
            )}
          </p>
          <CodeBlock label="Response" code={result.body || "(empty)"} />
        </div>
      )}
    </div>
  );
}
