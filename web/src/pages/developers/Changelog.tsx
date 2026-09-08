import { useEffect, useState } from "react";
import { releasesApi, type Release } from "../../api/releases";
import Prose from "../../components/developers/Prose";
import { formatDate } from "../../lib/datetime";

const LABEL: Record<string, string> = {
  feature: "New",
  improvement: "Improved",
  fix: "Fixed",
};

export default function Changelog() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    releasesApi
      .list()
      .then((rows) => { if (live) setReleases(rows); })
      .catch(() => undefined)
      .finally(() => { if (live) setLoaded(true); });
    return () => { live = false; };
  }, []);

  return (
    <div>
      <Prose>
        <h1 className="text-title-sm font-bold text-gray-800 dark:text-white/90">
          Changelog
        </h1>

        <h2>What we promise about versions</h2>

        <p>
          The product version is SemVer. The <strong>API</strong> version is
          separate and appears in the path. <code>/api/v1</code> is
          additive-only once published: new fields and new endpoints appear, but
          an existing field is never removed, renamed or retyped. Ignore
          unknown fields and your integration survives every release.
        </p>

        <p>
          A genuinely breaking change would ship as <code>/api/v2</code> served
          alongside <code>v1</code>, with a deprecation window announced before
          anything is retired. <code>GET /api/version</code> reports the build
          you are talking to.
        </p>

        <h2>Releases</h2>
      </Prose>

      {loaded && releases.length === 0 && (
        <p className="text-theme-sm text-gray-500 dark:text-gray-400">
          No releases have been published yet.
        </p>
      )}

      {releases.map((release) => (
        <section key={release.version} className="mt-6">
          <h3 className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">
            {release.version}
            {release.title ? ` — ${release.title}` : ""}
            <span className="ml-2 font-normal text-gray-400">
              {formatDate(release.released_at)}
            </span>
          </h3>
          <ul className="mt-2 space-y-1">
            {release.entries.map((entry, index) => (
              <li key={index} className="text-theme-sm text-gray-600 dark:text-gray-400">
                <span className="font-medium text-gray-700 dark:text-gray-300">
                  {LABEL[entry.type] ?? entry.type}
                </span>
                {" — "}
                {entry.summary}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
