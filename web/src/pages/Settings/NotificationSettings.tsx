import { useCallback, useEffect, useState } from "react";
import PageMeta from "../../components/common/PageMeta";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import ComponentCard from "../../components/common/ComponentCard";
import { useAuth } from "../../context/AuthContext";
import { settingsApi, type NotificationRule } from "../../api/settings";

const EVENT_LABEL: Record<string, string> = {
  "asset.checked_out": "An asset is checked out",
  "asset.checked_in": "An asset is returned",
  "asset.overdue": "An asset is overdue",
  "warranty.expiring": "A warranty is expiring",
  "licence.expiring": "A licence is expiring",
  "maintenance.due": "Maintenance is due",
  "import.completed": "An import finishes",
  "report.scheduled": "A scheduled report is sent",
};

function describeRecipients(spec: NotificationRule["recipient_spec"]): string {
  const parts: string[] = [];
  if (spec.assignee) parts.push("the assignee");
  if (spec.actor) parts.push("whoever performed the action");
  if (spec.roles?.length) parts.push(`all ${spec.roles.join(" and ")}s`);
  if (spec.emails?.length) parts.push(spec.emails.join(", "));
  return parts.length ? parts.join(", ") : "the schedule's recipient list";
}

export default function NotificationSettings() {
  const { can } = useAuth();
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [prefs, setPrefs] = useState<{ event: string; email_enabled: boolean }[]>([]);
  const [saved, setSaved] = useState(false);

  // Organisation rules need settings:write; a person's own preferences need
  // only the ordinary read permission everyone has. Two different audiences on
  // one page, so they are fetched and shown separately.
  const managesRules = can("settings:write");

  const load = useCallback(() => {
    if (managesRules) {
      void settingsApi.rules().then(setRules).catch(() => undefined);
    }
    void settingsApi.preferences().then(setPrefs).catch(() => undefined);
  }, [managesRules]);

  useEffect(load, [load]);

  async function savePreferences() {
    await settingsApi.savePreferences(prefs);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  return (
    <>
      <PageMeta title="Notifications | AMS" description="Notification rules and preferences" />
      <PageBreadcrumb pageTitle="Notifications" />

      <div className="space-y-5">
        {managesRules && (
          <ComponentCard
            title="Organisation rules"
            desc="Who gets told when something happens. Turning a rule off stops it for everyone."
          >
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {rules.map((rule) => (
                <li key={rule.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                      {EVENT_LABEL[rule.event] ?? rule.event}
                    </p>
                    <p className="text-theme-xs text-gray-500 dark:text-gray-400">
                      Emails {describeRecipients(rule.recipient_spec)}
                    </p>
                  </div>
                  <label className="ml-auto flex items-center gap-2 text-theme-xs text-gray-600 dark:text-gray-400">
                    <input
                      type="checkbox"
                      checked={rule.active}
                      onChange={async (e) => {
                        await settingsApi.updateRule(rule.id, { active: e.target.checked });
                        load();
                      }}
                      className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                    />
                    Enabled
                  </label>
                </li>
              ))}
            </ul>
          </ComponentCard>
        )}

        <ComponentCard
          title="Your preferences"
          desc="Turn off the emails you personally do not want. Organisation rules still apply to everyone else."
        >
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {prefs.map((pref) => (
              <li key={pref.event} className="flex items-center gap-3 py-3 first:pt-0">
                <span className="text-sm text-gray-800 dark:text-white/90">
                  {EVENT_LABEL[pref.event] ?? pref.event}
                </span>
                <label className="ml-auto flex items-center gap-2 text-theme-xs text-gray-600 dark:text-gray-400">
                  <input
                    type="checkbox"
                    checked={pref.email_enabled}
                    onChange={(e) =>
                      setPrefs((current) => current.map((p) =>
                        p.event === pref.event
                          ? { ...p, email_enabled: e.target.checked }
                          : p,
                      ))
                    }
                    className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                  />
                  Email me
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button" onClick={() => void savePreferences()}
              className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
            >
              Save preferences
            </button>
            {saved && (
              <span className="text-theme-xs text-success-500">Preferences saved.</span>
            )}
          </div>
        </ComponentCard>
      </div>
    </>
  );
}
