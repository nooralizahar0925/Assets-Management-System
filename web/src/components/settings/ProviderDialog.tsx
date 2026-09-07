import { useEffect, useState, type FormEvent } from "react";
import { Modal } from "../ui/modal";
import Label from "../form/Label";
import Input from "../form/input/InputField";
import {
  settingsApi, PROVIDER_FIELDS, PROVIDER_LABELS,
  type EmailProvider, type ProviderType,
} from "../../api/settings";
import { ApiError } from "../../api/client";

const selectClass =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm " +
  "text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 " +
  "focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

interface Props {
  isOpen: boolean;
  provider?: EmailProvider;
  onClose: () => void;
  onDone: () => void;
}

export default function ProviderDialog({ isOpen, provider, onClose, onDone }: Props) {
  const [name, setName] = useState("");
  const [type, setType] = useState<ProviderType>("smtp");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [priority, setPriority] = useState(100);
  const [active, setActive] = useState(true);
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!provider) return;
    setName(provider.name);
    setType(provider.type);
    setFromEmail(provider.from_email);
    setFromName(provider.from_name ?? "");
    setReplyTo(provider.reply_to ?? "");
    setPriority(provider.priority);
    setActive(provider.active);
    // Non-secret values are editable; secrets stay out of state so an untouched
    // secret is never sent back as its own mask.
    const fields = PROVIDER_FIELDS[provider.type];
    setConfig(Object.fromEntries(
      Object.entries(provider.config).filter(([key]) =>
        !fields.find((f) => f.key === key)?.secret,
      ),
    ));
  }, [provider]);

  const fields = PROVIDER_FIELDS[type];

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    setBanner(null);

    const payload = {
      name, type, from_email: fromEmail,
      from_name: fromName || null,
      reply_to: replyTo || null,
      priority, active, config,
    };

    try {
      if (provider) await settingsApi.updateProvider(provider.id, payload);
      else await settingsApi.createProvider(payload);
      onDone();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors);
        setBanner(err.problem.detail ?? err.message);
      } else {
        setBanner("Could not save this provider.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-h-[90vh] max-w-xl overflow-y-auto p-6">
      <h3 className="mb-1 text-lg font-medium text-gray-800 dark:text-white/90">
        {provider ? "Edit email provider" : "Add an email provider"}
      </h3>
      <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
        Providers are tried in priority order — a lower number is tried first — so a
        second provider acts as a fallback.
      </p>

      <form onSubmit={onSubmit} className="space-y-4">
        {banner && (
          <div role="alert" className="rounded-lg border border-error-500 bg-error-50 px-3 py-2 text-sm text-error-600 dark:bg-error-500/10">
            {banner}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="provider-name">Display name</Label>
            <Input id="provider-name" type="text" value={name}
                   error={Boolean(errors.name)}
                   onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="provider-type">Provider type</Label>
            <select
              id="provider-type" className={selectClass} value={type}
              onChange={(e) => {
                setType(e.target.value as ProviderType);
                setConfig({});
              }}
            >
              {Object.entries(PROVIDER_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="provider-from">From address</Label>
            <Input id="provider-from" type="email" value={fromEmail}
                   error={Boolean(errors.from_email)}
                   onChange={(e) => setFromEmail(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="provider-from-name">From name</Label>
            <Input id="provider-from-name" type="text" value={fromName}
                   onChange={(e) => setFromName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="provider-reply">Reply-to</Label>
            <Input id="provider-reply" type="email" value={replyTo}
                   onChange={(e) => setReplyTo(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="provider-priority">Priority</Label>
            <Input id="provider-priority" type="number" value={String(priority)}
                   onChange={(e) => setPriority(Number(e.target.value))} />
          </div>
        </div>

        <fieldset className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
          <legend className="px-2 text-sm font-medium text-gray-700 dark:text-gray-300">
            {PROVIDER_LABELS[type]} settings
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map((field) => {
              const id = `provider-${field.key}`;
              const error = errors[`config.${field.key}`];
              const masked =
                field.secret && provider
                  ? String(provider.config[field.key] ?? "")
                  : "";

              return (
                <div key={field.key} className={field.type === "checkbox" ? "sm:col-span-2" : ""}>
                  {field.type === "checkbox" ? (
                    <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                      <input
                        id={id} type="checkbox"
                        checked={Boolean(config[field.key])}
                        onChange={(e) =>
                          setConfig((c) => ({ ...c, [field.key]: e.target.checked }))
                        }
                        className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                      />
                      {field.label}
                    </label>
                  ) : field.type === "select" ? (
                    <>
                      <Label htmlFor={id}>{field.label}</Label>
                      <select
                        id={id} className={selectClass}
                        value={String(config[field.key] ?? field.options?.[0] ?? "")}
                        onChange={(e) =>
                          setConfig((c) => ({ ...c, [field.key]: e.target.value }))
                        }
                      >
                        {field.options?.map((option) => (
                          <option key={option} value={option}>{option.toUpperCase()}</option>
                        ))}
                      </select>
                    </>
                  ) : (
                    <>
                      <Label htmlFor={id}>{field.label}</Label>
                      <Input
                        id={id}
                        type={field.type === "number" ? "number" : field.type}
                        value={String(config[field.key] ?? "")}
                        error={Boolean(error)}
                        placeholder={masked ? `${masked} — leave blank to keep` : undefined}
                        onChange={(e) => {
                          const raw = e.target.value;
                          setConfig((c) => {
                            const next = { ...c };
                            // An emptied secret means "keep what is stored".
                            if (field.secret && raw === "") delete next[field.key];
                            else next[field.key] =
                              field.type === "number" ? Number(raw) : raw;
                            return next;
                          });
                        }}
                      />
                      {error && <p className="mt-1 text-theme-xs text-error-500">{error}</p>}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </fieldset>

        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox" checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
          />
          Active — include this provider when sending
        </label>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button" onClick={onClose}
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700"
          >
            Cancel
          </button>
          <button
            type="submit" disabled={saving}
            className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save provider"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
