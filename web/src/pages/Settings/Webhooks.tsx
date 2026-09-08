import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import PageMeta from "../../components/common/PageMeta";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import ComponentCard from "../../components/common/ComponentCard";
import Label from "../../components/form/Label";
import Input from "../../components/form/input/InputField";
import { useAuth } from "../../context/AuthContext";
import { ApiError } from "../../api/client";
import { webhooksApi, type Webhook, type CreatedWebhook } from "../../api/webhooks";

/**
 * Where this organisation sends its events.
 *
 * The API has been able to do this since the integration work; there was no
 * screen for it, which meant the only way to subscribe an endpoint was to POST
 * to the API by hand - and the signing secret, returned exactly once, arrived
 * in a terminal nobody was watching.
 */
export default function Webhooks() {
  const { can } = useAuth();
  const [hooks, setHooks] = useState<Webhook[]>([]);
  const [available, setAvailable] = useState<string[]>([]);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [created, setCreated] = useState<CreatedWebhook | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allowed = can("webhooks:write");

  const load = useCallback(() => {
    if (!allowed) return;
    void webhooksApi
      .list()
      .then((body) => {
        setHooks(body.data);
        // The subscribable events come from the server, so a newly published
        // one appears here without a web release.
        setAvailable(body.events);
      })
      .catch(() => undefined);
  }, [allowed]);

  useEffect(load, [load]);

  async function subscribe() {
    setError(null);
    try {
      const hook = await webhooksApi.create(url.trim(), events);
      setCreated(hook);
      setCopied(false);
      setUrl("");
      setEvents([]);
      load();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.problem.detail ?? err.message
          : "The endpoint could not be subscribed.",
      );
    }
  }

  if (!allowed) {
    return (
      <>
        <PageMeta title="Webhooks | AMS" description="Send events to another system" />
        <PageBreadcrumb pageTitle="Webhooks" />
        <div
          role="alert"
          className="rounded-2xl border border-gray-200 bg-white p-10 text-center dark:border-gray-800 dark:bg-white/[0.03]"
        >
          <h2 className="text-lg font-medium text-gray-800 dark:text-white/90">
            Webhooks are managed by an administrator
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-gray-500 dark:text-gray-400">
            Your role does not include managing where this organisation sends its
            events.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <PageMeta title="Webhooks | AMS" description="Send events to another system" />
      <PageBreadcrumb pageTitle="Webhooks" />

      <div className="space-y-5">
        {created && (
          <div className="rounded-2xl border border-warning-500 bg-warning-50 p-5 dark:bg-warning-500/10">
            <h3 className="text-sm font-medium text-warning-600">
              Copy this signing secret now — it will not be shown again
            </h3>
            <p className="mt-1 text-theme-xs text-warning-600/80">
              Your endpoint needs it to verify that a delivery came from us. If it
              is lost, delete this subscription and create another.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded-lg bg-white px-3 py-2.5 font-mono text-sm dark:bg-gray-900">
                {created.secret}
              </code>
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(created.secret);
                  setCopied(true);
                }}
                className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
              >
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                onClick={() => setCreated(null)}
                className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-white dark:text-gray-300 dark:ring-gray-700"
              >
                Done
              </button>
            </div>
          </div>
        )}

        <ComponentCard
          title="Send events to another system"
          desc="We POST a signed JSON body to your URL when something happens. A failed delivery is retried after 1, 5 and 30 minutes."
        >
          <div className="grid gap-4">
            <div>
              <Label htmlFor="hook-url">Endpoint URL</Label>
              <Input
                id="hook-url"
                type="text"
                value={url}
                placeholder="https://example.com/hooks/ams"
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="hook-events">Events</Label>
              <div id="hook-events" className="flex flex-wrap gap-2 pt-2">
                {available.map((event) => {
                  const on = events.includes(event);
                  return (
                    <button
                      key={event}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setEvents((current) =>
                          on ? current.filter((e) => e !== event) : [...current, event],
                        )
                      }
                      className={`rounded-full px-3 py-1 text-theme-xs font-medium ${
                        on
                          ? "bg-brand-500 text-white"
                          : "bg-gray-100 text-gray-600 dark:bg-white/[0.05] dark:text-gray-300"
                      }`}
                    >
                      {event}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {error && (
            <p role="alert" className="mt-3 text-theme-xs text-error-500">
              {error}
            </p>
          )}

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              disabled={!url.trim() || events.length === 0}
              onClick={() => void subscribe()}
              className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Subscribe
            </button>
            <Link
              to="/developers/webhooks"
              className="text-theme-xs font-medium text-brand-500 hover:text-brand-600"
            >
              How to verify a delivery
            </Link>
          </div>
        </ComponentCard>

        <ComponentCard title="Subscribed endpoints">
          {hooks.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
              Nothing subscribed yet. Add an endpoint to have another system told
              when assets change, instead of it polling.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {hooks.map((hook) => (
                <li
                  key={hook.id}
                  className="flex flex-wrap items-center gap-3 py-3 first:pt-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-800 dark:text-white/90">
                      {hook.url}
                    </p>
                    <p className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">
                      {hook.events.join(", ")}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      if (
                        !window.confirm(
                          `Delete this subscription? ${hook.url} will stop receiving events immediately.`,
                        )
                      ) {
                        return;
                      }
                      await webhooksApi.remove(hook.id);
                      load();
                    }}
                    className="ml-auto rounded-lg px-3 py-2 text-theme-xs font-medium text-gray-400 hover:text-error-500"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ComponentCard>
      </div>
    </>
  );
}
