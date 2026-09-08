import { useEffect, useState } from "react";
import PageMeta from "../../components/common/PageMeta";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import ComponentCard from "../../components/common/ComponentCard";
import UploadStep from "../../components/import/UploadStep";
import MappingStep from "../../components/import/MappingStep";
import PreviewStep from "../../components/import/PreviewStep";
import ResultStep from "../../components/import/ResultStep";
import { importsApi, type ImportResult, type InspectResult } from "../../api/imports";
import { catalogApi } from "../../api/catalog";
import { useAuth } from "../../context/AuthContext";
import { ApiError } from "../../api/client";
import type { Category } from "../../api/types";

type Step = "upload" | "map" | "preview" | "done";

const STEPS: { key: Step; label: string }[] = [
  { key: "upload", label: "Upload" },
  { key: "map", label: "Map columns" },
  { key: "preview", label: "Preview" },
  { key: "done", label: "Done" },
];

/** Explains why importing is closed, rather than failing after a file is chosen. */
function Unavailable({ reason }: { reason: string }) {
  return (
    <>
      <PageMeta title="Import | AMS" description="Bulk import assets" />
      <PageBreadcrumb pageTitle="Import" />
      <div
        role="alert"
        className="rounded-2xl border border-gray-200 bg-white p-10 text-center dark:border-gray-800 dark:bg-white/[0.03]"
      >
        <h2 className="text-lg font-medium text-gray-800 dark:text-white/90">
          Importing is not available to you
        </h2>
        <p className="mx-auto mt-2 max-w-lg text-sm text-gray-500 dark:text-gray-400">
          {reason}
        </p>
      </div>
    </>
  );
}

export default function ImportWizard() {
  const [step, setStep] = useState<Step>("upload");
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [inspected, setInspected] = useState<InspectResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [dryRun, setDryRun] = useState<ImportResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { can, user } = useAuth();

  const allowed = can("assets:import");
  // The API refuses a branch-scoped account outright: an imported asset carries
  // no location, so it would land somewhere the importer cannot see. Saying so
  // here saves them preparing a spreadsheet for a 403.
  const branchScoped = (user?.location_scope?.length ?? 0) > 0;

  useEffect(() => {
    if (!allowed || branchScoped) return;
    void catalogApi.categories().then(setCategories).catch(() => undefined);
  }, [allowed, branchScoped]);

  const schema =
    categories.find((c) => c.id === categoryId)?.field_schema.fields ?? [];

  async function onFile(chosen: File) {
    setBusy(true);
    setError(null);
    try {
      const inspection = await importsApi.inspect(chosen, categoryId);
      setFile(chosen);
      setInspected(inspection);
      setMapping(inspection.suggested_mapping);
      setStep("map");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.problem.detail ?? err.message
          : "Could not read that file.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function runDryRun() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setDryRun(await importsApi.run(file, mapping, categoryId, true));
      setStep("preview");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The preview failed.");
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await importsApi.run(file, mapping, categoryId, false));
      setStep("done");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The import failed.");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStep("upload");
    setFile(null);
    setInspected(null);
    setMapping({});
    setDryRun(null);
    setResult(null);
  }

  if (!allowed) {
    return (
      <Unavailable reason="Your role does not include importing assets. Ask an administrator if you need it." />
    );
  }
  if (branchScoped) {
    return (
      <Unavailable
        reason={
          "Your account is limited to specific branches. Imported assets have no " +
          "location, so they would not be visible to you afterwards. Ask an " +
          "organisation-wide administrator to run the import."
        }
      />
    );
  }

  const activeIndex = STEPS.findIndex((s) => s.key === step);

  return (
    <>
      <PageMeta title="Import | AMS" description="Bulk import assets" />
      <PageBreadcrumb pageTitle="Import" />

      <ol className="mb-6 flex flex-wrap items-center gap-2">
        {STEPS.map((entry, index) => (
          <li key={entry.key} className="flex items-center gap-2">
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full text-theme-xs font-medium ${
                index <= activeIndex
                  ? "bg-brand-500 text-white"
                  : "bg-gray-100 text-gray-500 dark:bg-white/[0.05] dark:text-gray-400"
              }`}
            >
              {index + 1}
            </span>
            <span className={`text-sm ${
              index === activeIndex
                ? "font-medium text-gray-800 dark:text-white/90"
                : "text-gray-500 dark:text-gray-400"
            }`}>
              {entry.label}
            </span>
            {index < STEPS.length - 1 && (
              <span aria-hidden className="mx-2 h-px w-8 bg-gray-200 dark:bg-gray-800" />
            )}
          </li>
        ))}
      </ol>

      {error && (
        <div role="alert" className="mb-5 rounded-lg border border-error-500 bg-error-50 px-4 py-3 text-sm text-error-600 dark:bg-error-500/10">
          {error}
        </div>
      )}

      {step === "upload" && (
        <ComponentCard title="Choose a file" desc="CSV or Excel, up to 10 MB.">
          <UploadStep
            categories={categories} categoryId={categoryId}
            onCategory={setCategoryId} onFile={onFile} busy={busy}
          />
        </ComponentCard>
      )}

      {step === "map" && inspected && (
        <ComponentCard
          title="Map your columns"
          desc={`${inspected.row_count.toLocaleString("en-GB")} rows found. Confirm where each column should land.`}
        >
          <MappingStep
            headers={inspected.headers}
            sample={inspected.sample}
            schema={schema}
            value={mapping}
            onChange={(header, target) =>
              setMapping((current) => ({ ...current, [header]: target }))
            }
          />
          <div className="mt-5 flex items-center gap-3">
            <button
              type="button" onClick={runDryRun} disabled={busy}
              className="rounded-lg bg-brand-500 px-5 py-3.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {busy ? "Checking…" : "Preview the import"}
            </button>
            <button
              type="button" onClick={reset}
              className="rounded-lg px-5 py-3.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700"
            >
              Start over
            </button>
          </div>
        </ComponentCard>
      )}

      {step === "preview" && dryRun && (
        <ComponentCard title="Preview" desc="Nothing is saved until you confirm.">
          <PreviewStep
            result={dryRun} committing={busy}
            onCommit={commit} onBack={() => setStep("map")}
          />
        </ComponentCard>
      )}

      {step === "done" && result && <ResultStep result={result} onAnother={reset} />}
    </>
  );
}
