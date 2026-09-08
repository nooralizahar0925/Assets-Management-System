import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import PageMeta from "../../components/common/PageMeta";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import ComponentCard from "../../components/common/ComponentCard";
import Badge from "../../components/ui/badge/Badge";
import { importsApi, type ImportJob as Job } from "../../api/imports";

/**
 * What one past import did.
 *
 * This page exists because the import-completed email links to it. That link
 * has been in the email template since the notification work and led to the
 * not-found page - harmless while the event never fired, and a broken promise
 * the moment it did.
 */
export default function ImportJob() {
  const { id } = useParams();
  const [job, setJob] = useState<Job | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!id) return;
    let live = true;
    importsApi
      .job(id)
      .then((row) => { if (live) setJob(row); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [id]);

  if (failed) {
    return (
      <>
        <PageMeta title="Import | AMS" description="A past import" />
        <PageBreadcrumb pageTitle="Import" />
        <div
          role="alert"
          className="rounded-2xl border border-gray-200 bg-white p-10 text-center dark:border-gray-800 dark:bg-white/[0.03]"
        >
          <h2 className="text-lg font-medium text-gray-800 dark:text-white/90">
            That import could not be found
          </h2>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            It may belong to another organisation, or have been removed.{" "}
            <Link to="/import" className="text-brand-500 hover:text-brand-600">
              Start a new import
            </Link>
            .
          </p>
        </div>
      </>
    );
  }

  if (!job) {
    return <p className="p-8 text-sm text-gray-500">Loading…</p>;
  }

  const errors = job.errors ?? [];

  return (
    <>
      <PageMeta title="Import | AMS" description="A past import" />
      <PageBreadcrumb pageTitle="Import" />

      <div className="space-y-5">
        <ComponentCard
          title={job.filename}
          desc={`Imported ${new Date(job.created_at).toLocaleString("en-GB")}`}
        >
          <div className="flex flex-wrap items-center gap-3">
            {job.dry_run && <Badge color="warning" size="sm">Preview only</Badge>}
            <Badge color={job.status === "completed" ? "success" : "light"} size="sm">
              {job.status}
            </Badge>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              ["Rows read", job.total],
              ["Created", job.created],
              ["Updated", job.updated],
              ["Rejected", errors.length],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt className="text-theme-xs text-gray-500 dark:text-gray-400">{label}</dt>
                <dd className="text-title-sm font-semibold text-gray-800 dark:text-white/90">
                  {value}
                </dd>
              </div>
            ))}
          </dl>

          {job.dry_run && (
            <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
              This was a dry run: nothing was written. Re-run the same file and
              mapping with the preview turned off to commit it.
            </p>
          )}
        </ComponentCard>

        {errors.length > 0 && (
          <ComponentCard
            title="Rows that were rejected"
            desc="Every other row was imported. Fix these and import them again."
          >
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {errors.map((error, index) => (
                <li key={index} className="py-2 text-sm first:pt-0">
                  <span className="font-medium text-gray-800 dark:text-white/90">
                    Row {error.row}
                  </span>
                  <span className="ml-2 text-gray-400">{error.field}</span>
                  <span className="ml-2 text-gray-600 dark:text-gray-400">
                    {error.message}
                  </span>
                </li>
              ))}
            </ul>
          </ComponentCard>
        )}

        <Link
          to="/import"
          className="inline-block text-sm font-medium text-brand-500 hover:text-brand-600"
        >
          Import another spreadsheet
        </Link>
      </div>
    </>
  );
}
