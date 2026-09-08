import { useCallback, useEffect, useState } from "react";
import PageMeta from "../../components/common/PageMeta";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import ComponentCard from "../../components/common/ComponentCard";
import ProviderList from "../../components/settings/ProviderList";
import ProviderDialog from "../../components/settings/ProviderDialog";
import TemplateEditor from "../../components/settings/TemplateEditor";
import Badge from "../../components/ui/badge/Badge";
import { useModal } from "../../hooks/useModal";
import { useAuth } from "../../context/AuthContext";
import {
  settingsApi, type EmailProvider, type EmailMessage, type EmailTemplate,
} from "../../api/settings";
import { formatDateTime } from "../../lib/datetime";

const STATUS_COLOR: Record<string, "success" | "warning" | "error" | "light"> = {
  sent: "success", queued: "warning", sending: "warning",
  failed: "error", cancelled: "light",
};

export default function EmailSettings() {
  const dialog = useModal();
  const { can } = useAuth();
  const [providers, setProviders] = useState<EmailProvider[]>([]);
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [editing, setEditing] = useState<EmailProvider | undefined>();

  // Every endpoint on this page requires settings:write. Without it there is
  // nothing to show, so say why rather than rendering empty cards built from
  // swallowed 403s.
  const allowed = can("settings:write");

  const load = useCallback(() => {
    if (!allowed) return;
    void settingsApi.providers().then(setProviders).catch(() => undefined);
    void settingsApi.messages(25).then(setMessages).catch(() => undefined);
    void settingsApi.templates().then(setTemplates).catch(() => undefined);
  }, [allowed]);

  useEffect(load, [load]);

  if (!allowed) {
    return (
      <>
        <PageMeta title="Email settings | AMS" description="Email providers and delivery log" />
        <PageBreadcrumb pageTitle="Email" />
        <div
          role="alert"
          className="rounded-2xl border border-gray-200 bg-white p-10 text-center dark:border-gray-800 dark:bg-white/[0.03]"
        >
          <h2 className="text-lg font-medium text-gray-800 dark:text-white/90">
            Email settings are managed by an administrator
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-gray-500 dark:text-gray-400">
            Your role does not include changing organisation settings. You can still
            choose which emails you personally receive under Notifications.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <PageMeta title="Email settings | AMS" description="Email providers and delivery log" />
      <PageBreadcrumb pageTitle="Email" />

      <div className="space-y-5">
        <ComponentCard
          title="Providers"
          desc="Add more than one — if the first fails, the next is tried automatically."
        >
          <div className="mb-4">
            <button
              type="button"
              onClick={() => { setEditing(undefined); dialog.openModal(); }}
              className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
            >
              Add provider
            </button>
          </div>
          <ProviderList
            providers={providers}
            onEdit={(provider) => { setEditing(provider); dialog.openModal(); }}
            onChanged={load}
          />
        </ComponentCard>

        <ComponentCard
          title="Email wording"
          desc="Reword any email this system sends. Leave one alone to keep the built-in text."
        >
          <TemplateEditor templates={templates} onChanged={load} />
        </ComponentCard>

        <ComponentCard title="Recent messages" desc="The last 25 emails this system queued.">
          {messages.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
              No email has been queued yet.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {messages.map((message) => (
                <li key={message.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
                  <Badge color={STATUS_COLOR[message.status] ?? "light"} size="sm">
                    {message.status}
                  </Badge>
                  <div className="min-w-0">
                    <p className="truncate text-sm text-gray-800 dark:text-white/90">
                      {message.subject}
                    </p>
                    <p className="text-theme-xs text-gray-500 dark:text-gray-400">
                      {message.to_addresses.join(", ")}
                      {message.provider_name && ` · via ${message.provider_name}`}
                      {message.attempts > 1 && ` · ${message.attempts} attempts`}
                    </p>
                    {message.last_error && (
                      <p className="text-theme-xs text-error-500">{message.last_error}</p>
                    )}
                  </div>
                  <time className="ml-auto shrink-0 text-theme-xs text-gray-400">
                    {formatDateTime(message.created_at)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </ComponentCard>
      </div>

      <ProviderDialog
        isOpen={dialog.isOpen}
        provider={editing}
        onClose={dialog.closeModal}
        onDone={() => { dialog.closeModal(); load(); }}
      />
    </>
  );
}
