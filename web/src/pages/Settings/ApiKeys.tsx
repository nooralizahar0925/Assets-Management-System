import { useCallback, useEffect, useState } from "react";
import PageMeta from "../../components/common/PageMeta";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import ComponentCard from "../../components/common/ComponentCard";
import Badge from "../../components/ui/badge/Badge";
import Label from "../../components/form/Label";
import Input from "../../components/form/input/InputField";
import { useAuth } from "../../context/AuthContext";
import { keysApi, type ApiKey, type MintedApiKey } from "../../api/admin";

/** The published v1 scopes. Frozen: integrations depend on these names. */
const SCOPES = ["assets:read", "assets:write", "reports:read", "admin"] as const;

export default function ApiKeys() {
  const { can } = useAuth();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["assets:read"]);
  const [minted, setMinted] = useState<MintedApiKey | null>(null);
  const [copied, setCopied] = useState(false);

  const canRead = can("api_keys:read");
  const canWrite = can("api_keys:write");

  const load = useCallback(() => {
    if (!canRead) return;
    void keysApi.list().then(setKeys).catch(() => undefined);
  }, [canRead]);

  useEffect(load, [load]);

  async function mint() {
    if (!name.trim() || scopes.length === 0) return;
    const created = await keysApi.create(name, scopes);
    setMinted(created);
    setName("");
    setCopied(false);
    load();
  }

  if (!canRead) {
    return (
      <>
        <PageMeta title="API keys | AMS" description="Keys for integrating other systems" />
        <PageBreadcrumb pageTitle="API keys" />
        <div
          role="alert"
          className="rounded-2xl border border-gray-200 bg-white p-10 text-center dark:border-gray-800 dark:bg-white/[0.03]"
        >
          <h2 className="text-lg font-medium text-gray-800 dark:text-white/90">
            API keys are managed by an administrator
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-gray-500 dark:text-gray-400">
            Your role does not include viewing this organisation's integration keys.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <PageMeta title="API keys | AMS" description="Keys for integrating other systems" />
      <PageBreadcrumb pageTitle="API keys" />

      <div className="space-y-5">
        {minted && (
          <div className="rounded-2xl border border-warning-500 bg-warning-50 p-5 dark:bg-warning-500/10">
            <h3 className="text-sm font-medium text-warning-600">
              Copy this key now — it will not be shown again
            </h3>
            <p className="mt-1 text-theme-xs text-warning-600/80">
              Only a hash is stored. If you lose this key, revoke it and mint another.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded-lg bg-white px-3 py-2.5 font-mono text-sm dark:bg-gray-900">
                {minted.key}
              </code>
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(minted.key);
                  setCopied(true);
                }}
                className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
              >
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                onClick={() => setMinted(null)}
                className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-white dark:text-gray-300 dark:ring-gray-700"
              >
                Done
              </button>
            </div>
          </div>
        )}

        {canWrite && (
          <ComponentCard
            title="Create a key"
            desc="Give each integration its own key with the narrowest scopes it needs."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="key-name">Name</Label>
                <Input
                  id="key-name" type="text" value={name}
                  placeholder="HR system, warehouse scanner, reporting job"
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="key-scopes">Scopes</Label>
                <div className="flex flex-wrap gap-2 pt-2">
                  {SCOPES.map((scope) => {
                    const on = scopes.includes(scope);
                    return (
                      <button
                        key={scope}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          setScopes((current) =>
                            on ? current.filter((s) => s !== scope) : [...current, scope],
                          )
                        }
                        className={`rounded-full px-3 py-1 text-theme-xs font-medium ${
                          on
                            ? "bg-brand-500 text-white"
                            : "bg-gray-100 text-gray-600 dark:bg-white/[0.05] dark:text-gray-300"
                        }`}
                      >
                        {scope}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="mt-4">
              <button
                type="button" onClick={() => void mint()}
                className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
              >
                Create key
              </button>
            </div>
          </ComponentCard>
        )}

        <ComponentCard title="Existing keys">
          {keys.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
              No keys yet. Create one to let another system talk to this API.
            </p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {keys.map((key) => (
                <li key={key.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-800 dark:text-white/90">
                        {key.name}
                      </span>
                      {key.revoked_at && <Badge color="error" size="sm">Revoked</Badge>}
                    </div>
                    <p className="mt-0.5 font-mono text-theme-xs text-gray-500 dark:text-gray-400">
                      {key.prefix}… · {key.scopes.join(", ")}
                    </p>
                    <p className="text-theme-xs text-gray-400">
                      {key.last_used_at
                        ? `Last used ${new Date(key.last_used_at).toLocaleString("en-GB")}`
                        : "Never used"}
                    </p>
                  </div>
                  {canWrite && !key.revoked_at && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!window.confirm(
                          `Revoke "${key.name}"? Any integration using it will stop working immediately.`,
                        )) return;
                        await keysApi.revoke(key.id);
                        load();
                      }}
                      className="ml-auto rounded-lg px-3 py-2 text-theme-xs font-medium text-gray-400 hover:text-error-500"
                    >
                      Revoke
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </ComponentCard>
      </div>
    </>
  );
}
