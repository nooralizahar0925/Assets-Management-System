import { useEffect, useState } from "react";
import PageMeta from "../components/common/PageMeta";
import PageBreadcrumb from "../components/common/PageBreadCrumb";
import Badge from "../components/ui/badge/Badge";
import {
  releasesApi, type Release, type VersionInfo, type EntryType,
} from "../api/releases";

/**
 * What changed, written for the person using the system.
 *
 * People notice when a screen moves and are unsettled when nobody told them.
 * The entries come from the release notes an author wrote, not from commit
 * subjects, which describe the code rather than what anyone can now do.
 */

/** Plain words rather than the internal type names. */
const ENTRY_LABEL: Record<EntryType, { label: string; color: "success" | "info" | "warning" }> = {
  feature: { label: "New", color: "success" },
  improvement: { label: "Improved", color: "info" },
  fix: { label: "Fixed", color: "warning" },
};

const formatDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });

export default function WhatsNew() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [build, setBuild] = useState<VersionInfo | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void releasesApi.list()
      .then((list) => {
        if (cancelled) return;
        setReleases(list);

        // Opening the page is the act of reading them. Only the newest is
        // marked: everything below it is older, so one call clears the lot.
        if (list.length > 0) {
          void releasesApi.markSeen(list[0].version).catch(() => undefined);
        }
      })
      // A changelog is not worth an error screen. The rest of the product
      // works, and an empty list says as much as a failure message would.
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setLoaded(true); });

    void releasesApi.version().then((v) => {
      if (!cancelled) setBuild(v);
    }).catch(() => undefined);

    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <PageMeta title="What's new | AMS" description="Recent changes to the system" />
      <PageBreadcrumb pageTitle="What's new" />

      <div className="space-y-5">
        {loaded && releases.length === 0 && (
          <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center dark:border-gray-800 dark:bg-white/[0.03]">
            <h2 className="text-lg font-medium text-gray-800 dark:text-white/90">
              No release notes yet
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-gray-500 dark:text-gray-400">
              When something changes in the system, it will be described here.
            </p>
          </div>
        )}

        {releases.map((release) => (
          <article
            key={release.version}
            className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]"
          >
            <div className="flex flex-wrap items-baseline gap-3">
              {/* h3: the page's own title is the h2, supplied by the
                  breadcrumb, and each release is a section beneath it. */}
              <h3 className="text-lg font-medium text-gray-800 dark:text-white/90">
                {release.title}
              </h3>
              <Badge color="light" size="sm">{release.version}</Badge>
              <time
                className="ml-auto text-theme-xs text-gray-500 dark:text-gray-400"
                dateTime={release.released_at}
              >
                {formatDate(release.released_at)}
              </time>
            </div>

            <ul className="mt-4 space-y-3">
              {release.entries.map((entry, index) => {
                const kind = ENTRY_LABEL[entry.type] ?? ENTRY_LABEL.improvement;
                return (
                  <li key={index} className="flex flex-wrap items-baseline gap-3">
                    <Badge color={kind.color} size="sm">{kind.label}</Badge>
                    <span className="flex-1 text-sm text-gray-700 dark:text-gray-300">
                      {entry.summary}
                    </span>
                  </li>
                );
              })}
            </ul>
          </article>
        ))}

        {build && (
          <p className="text-center text-theme-xs text-gray-400">
            {/* Worth showing: a support conversation starts with which build
                somebody is actually on. */}
            Running version {build.version} ({build.git_sha})
          </p>
        )}
      </div>
    </>
  );
}
