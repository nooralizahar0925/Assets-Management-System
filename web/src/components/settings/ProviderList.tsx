import { useState } from "react";
import Badge from "../ui/badge/Badge";
import { settingsApi, PROVIDER_LABELS, type EmailProvider } from "../../api/settings";

export default function ProviderList({
  providers, onEdit, onChanged,
}: {
  providers: EmailProvider[];
  onEdit: (provider: EmailProvider) => void;
  onChanged: () => void;
}) {
  const [testing, setTesting] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Record<string, string>>({});

  async function test(provider: EmailProvider) {
    const to = window.prompt("Send a test email to which address?");
    if (!to) return;
    setTesting(provider.id);
    try {
      const result = await settingsApi.testProvider(provider.id, to);
      setOutcome((current) => ({
        ...current,
        [provider.id]: result.ok
          ? `Test email sent to ${to}.`
          : `Failed: ${result.error ?? "unknown error"}`,
      }));
      onChanged();
    } finally {
      setTesting(null);
    }
  }

  if (providers.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
        No email provider is configured yet. Until one is added, notifications queue but
        cannot be delivered.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
      {providers.map((provider) => (
        <li key={provider.id} className="py-4 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-800 dark:text-white/90">
                  {provider.name}
                </span>
                <Badge color={provider.active ? "success" : "light"} size="sm">
                  {provider.active ? "Active" : "Inactive"}
                </Badge>
                {provider.verified_at && (
                  <Badge color="info" size="sm">Verified</Badge>
                )}
              </div>
              <p className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">
                {PROVIDER_LABELS[provider.type]} · {provider.from_email} · priority{" "}
                {provider.priority}
              </p>
            </div>

            <div className="ml-auto flex gap-2">
              <button
                type="button" onClick={() => void test(provider)}
                disabled={testing === provider.id}
                className="rounded-lg px-3 py-2 text-theme-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 disabled:opacity-50 dark:text-gray-300 dark:ring-gray-700"
              >
                {testing === provider.id ? "Sending…" : "Send test"}
              </button>
              <button
                type="button" onClick={() => onEdit(provider)}
                className="rounded-lg px-3 py-2 text-theme-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={async () => {
                  await settingsApi.deleteProvider(provider.id);
                  onChanged();
                }}
                className="rounded-lg px-3 py-2 text-theme-xs font-medium text-gray-400 hover:text-error-500"
              >
                Remove
              </button>
            </div>
          </div>

          {provider.last_error && (
            <p className="mt-2 rounded-lg bg-error-50 px-3 py-2 text-theme-xs text-error-600 dark:bg-error-500/10">
              Last error: {provider.last_error}
            </p>
          )}
          {outcome[provider.id] && (
            <p className="mt-2 text-theme-xs text-gray-500 dark:text-gray-400">
              {outcome[provider.id]}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
