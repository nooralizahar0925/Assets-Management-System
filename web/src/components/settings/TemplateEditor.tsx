import { useEffect, useState } from "react";
import Label from "../form/Label";
import Input from "../form/input/InputField";
import TextArea from "../form/input/TextArea";
import Badge from "../ui/badge/Badge";
import { settingsApi, type EmailTemplate } from "../../api/settings";
import { ApiError } from "../../api/client";

const selectClass =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm " +
  "text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 " +
  "focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

const TEMPLATE_LABEL: Record<string, string> = {
  "asset.checked_out": "Asset checked out",
  "asset.checked_in": "Asset returned",
  "asset.overdue": "Asset overdue",
  "warranty.expiring": "Warranty expiring",
  "licence.expiring": "Licence expiring",
  "maintenance.due": "Maintenance due",
  "import.completed": "Import finished",
  "report.scheduled": "Scheduled report",
};

/**
 * Lets a customer reword the emails the system sends them. The API stores an
 * override per key and falls back to the built-in wording, so "Reset to
 * default" is a real state rather than a copy of the current text.
 */
export default function TemplateEditor({
  templates, onChanged,
}: { templates: EmailTemplate[]; onChanged: () => void }) {
  const [key, setKey] = useState("");
  const [subject, setSubject] = useState("");
  const [html, setHtml] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const selected = templates.find((t) => t.key === key);

  // Load whichever template is chosen, and re-load when the list refreshes
  // after a save so the "Customised" badge reflects what is stored.
  useEffect(() => {
    const current = templates.find((t) => t.key === key) ?? templates[0];
    if (!current) return;
    if (!key) setKey(current.key);
    setSubject(current.subject);
    setHtml(current.html_body);
    setText(current.text_body);
  }, [key, templates]);

  if (templates.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
        No email templates are available yet.
      </p>
    );
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await settingsApi.saveTemplate({
        key, subject, html_body: html, text_body: text,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      onChanged();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.problem.detail ?? err.message
          : "Could not save this template.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="rounded-lg border border-error-500 bg-error-50 px-3 py-2 text-sm text-error-600 dark:bg-error-500/10">
          {error}
        </div>
      )}

      <div>
        <Label htmlFor="template-key">Email</Label>
        <select
          id="template-key" className={selectClass} value={key}
          onChange={(e) => setKey(e.target.value)}
        >
          {templates.map((template) => (
            <option key={template.key} value={template.key}>
              {TEMPLATE_LABEL[template.key] ?? template.key}
            </option>
          ))}
        </select>
        <p className="mt-2 flex items-center gap-2 text-theme-xs text-gray-500 dark:text-gray-400">
          {selected?.customised ? (
            <Badge color="info" size="sm">Customised</Badge>
          ) : (
            <Badge color="light" size="sm">Built-in wording</Badge>
          )}
          Placeholders such as {"{{asset_name}}"} are filled in when the email is sent.
        </p>
      </div>

      <div>
        <Label htmlFor="template-subject">Subject</Label>
        <Input
          id="template-subject" type="text" value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
      </div>

      <div>
        <Label htmlFor="template-html">HTML body</Label>
        <TextArea value={html} onChange={setHtml} rows={10} />
      </div>

      <div>
        <Label htmlFor="template-text">Plain-text body</Label>
        <TextArea value={text} onChange={setText} rows={6} />
        <p className="mt-1 text-theme-xs text-gray-400">
          Sent to people whose mail client refuses HTML. Keep it in step with the
          HTML version.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button" onClick={() => void save()} disabled={saving}
          className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save template"}
        </button>
        {saved && <span className="text-theme-xs text-success-500">Template saved.</span>}
      </div>
    </div>
  );
}
