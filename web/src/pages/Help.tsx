import { useState } from "react";
import { Link, useParams } from "react-router";
import PageMeta from "../components/common/PageMeta";
import PageBreadcrumb from "../components/common/PageBreadCrumb";
import { Blocks } from "../content/help/blocks";
import { ARTICLES, SECTIONS, searchArticles } from "../content/help/articles";
import { useTour } from "../components/help/TourProvider";

export default function Help() {
  const { slug } = useParams();
  const [query, setQuery] = useState("");
  const { start } = useTour();

  const article = slug ? ARTICLES.find((a) => a.slug === slug) : undefined;

  if (slug && !article) {
    return (
      <>
        <PageMeta title="Help | AMS" description="Guides for using the asset register" />
        <PageBreadcrumb pageTitle="Help" />
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center dark:border-gray-800 dark:bg-white/[0.03]">
          <h2 className="text-lg font-medium text-gray-800 dark:text-white/90">
            That article does not exist
          </h2>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            It may have been renamed.{" "}
            <Link to="/help" className="text-brand-500 hover:text-brand-600">
              Back to the help centre
            </Link>
            .
          </p>
        </div>
      </>
    );
  }

  if (article) {
    return (
      <>
        <PageMeta title={`${article.title} | Help`} description={article.summary} />
        <PageBreadcrumb pageTitle={article.title} />
        <article className="max-w-3xl rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
          <p className="mb-1 text-theme-xs uppercase tracking-wide text-gray-400">
            {article.section}
          </p>
          <h1 className="mb-4 text-title-sm font-bold text-gray-800 dark:text-white/90">
            {article.title}
          </h1>
          <Blocks blocks={article.blocks} />
          <Link
            to="/help"
            className="mt-6 inline-block text-sm font-medium text-brand-500 hover:text-brand-600"
          >
            All articles
          </Link>
        </article>
      </>
    );
  }

  const results = searchArticles(query);

  return (
    <>
      <PageMeta title="Help | AMS" description="Guides for using the asset register" />
      <PageBreadcrumb pageTitle="Help" />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <input
          type="search"
          aria-label="Search help"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search help — try scanning, import, overdue"
          className="h-11 w-full max-w-md rounded-lg border border-gray-300 px-4 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
        />
        <button
          type="button"
          onClick={start}
          className="text-sm font-medium text-brand-500 hover:text-brand-600"
        >
          Replay the guided tour
        </button>
      </div>

      {results.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No articles match “{query}”. Try a word from the screen you are looking at.
        </p>
      )}

      {SECTIONS
        .filter((section) => results.some((a) => a.section === section))
        .map((section) => (
          <section key={section} className="mb-8">
            <h2 className="mb-3 text-theme-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {section}
            </h2>
            <ul className="space-y-2">
              {results
                .filter((a) => a.section === section)
                .map((a) => (
                  <li key={a.slug}>
                    <Link
                      to={`/help/${a.slug}`}
                      className="block rounded-xl border border-gray-200 p-4 transition hover:border-brand-400 dark:border-gray-800 dark:hover:border-brand-500"
                    >
                      <span className="font-medium text-gray-800 dark:text-white/90">
                        {a.title}
                      </span>
                      <span className="mt-1 block text-sm text-gray-500 dark:text-gray-400">
                        {a.summary}
                      </span>
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        ))}
    </>
  );
}
