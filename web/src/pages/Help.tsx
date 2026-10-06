import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import PageMeta from "../components/common/PageMeta";
import PageBreadcrumb from "../components/common/PageBreadCrumb";
import { Blocks } from "../content/help/blocks";
import { ARTICLES, SECTIONS, searchArticles } from "../content/help/articles";
import { WALKTHROUGH_STEPS } from "../content/help/walkthrough";
import { useTour } from "../components/help/TourProvider";

const card = "rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]";
const button = "rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/5";

export default function Help() {
  const { slug } = useParams();
  const [query, setQuery] = useState("");
  const [walkthroughOpen, setWalkthroughOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [complete, setComplete] = useState(false);
  const { start, userId, permissions } = useTour();
  const article = slug ? ARTICLES.find((item) => item.slug === slug) : ARTICLES[0];
  const results = searchArticles(query);
  const steps = WALKTHROUGH_STEPS.filter((step) => !step.permission || !permissions || permissions.includes(step.permission));
  const activeStep = steps[Math.min(stepIndex, steps.length - 1)];
  const storageKey = `ams.guide.walkthrough.v1.${userId ?? "guest"}`;

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { id?: string; complete?: boolean } | null;
      const index = steps.findIndex((step) => step.id === saved?.id);
      setStepIndex(index >= 0 ? index : 0);
      setComplete(Boolean(saved?.complete));
    } catch {
      setStepIndex(0);
      setComplete(false);
    }
  }, [storageKey, permissions]);

  const saveStep = (index: number, done = false) => {
    const next = Math.max(0, Math.min(index, steps.length - 1));
    setStepIndex(next);
    setComplete(done);
    try {
      localStorage.setItem(storageKey, JSON.stringify({ id: steps[next].id, complete: done }));
    } catch {
      // The guide still works when the browser blocks storage.
    }
  };

  return <div className="asset-help-page">
    <PageMeta title="Help & tutorial | AMS" description="Guides for using the asset register" />
    <PageBreadcrumb pageTitle="Help & tutorial" />
    <div className="mb-6">
      <p className="text-theme-xs font-semibold uppercase tracking-wide text-brand-500">Learning centre</p>
      <h1 className="mt-1 text-title-sm font-bold text-gray-800 dark:text-white/90">Help & tutorial</h1>
      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Find a task guide or follow the optional first-time walkthrough.</p>
    </div>
    <div className="grid items-start gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className={`asset-help-index ${card} lg:sticky lg:top-6`} aria-label="Guide topics">
        <label htmlFor="help-search" className="block text-xs font-semibold text-gray-600 dark:text-gray-300">Search guides</label>
        <input id="help-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tasks and terms" className="mt-2 h-10 w-full rounded-lg border border-gray-300 px-3 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90" />
        <nav className="mt-4 max-h-[60vh] space-y-4 overflow-y-auto" aria-label="Guide topics">
          {results.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-400">No guides match your search. Try another task or term.</p>}
          {SECTIONS.filter((section) => results.some((item) => item.section === section)).map((section) => <div key={section}>
            <h2 className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{section}</h2>
            {results.filter((item) => item.section === section).map((item) => <Link key={item.slug} to={`/help/${item.slug}`} aria-current={article?.slug === item.slug ? "page" : undefined} className={`block rounded-lg border px-3 py-2 text-sm transition ${article?.slug === item.slug ? "border-brand-300 bg-brand-50 font-semibold text-brand-700 dark:border-brand-500 dark:bg-brand-500/10 dark:text-brand-400" : "border-transparent text-gray-700 hover:border-gray-200 hover:bg-gray-50 dark:text-gray-300 dark:hover:border-gray-700 dark:hover:bg-white/5"}`}>{item.title}</Link>)}
          </div>)}
        </nav>
      </aside>
      <div className="min-w-0 space-y-5">
        <article className={`asset-help-article ${card}`} aria-labelledby="help-article-title">
          {article ? <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="text-theme-xs font-semibold uppercase tracking-wide text-brand-500">{article.section}</p><h2 id="help-article-title" className="mt-1 text-xl font-bold text-gray-800 dark:text-white/90">{article.title}</h2></div>
              <button type="button" onClick={() => window.print()} className={`asset-help-print ${button}`}>Print this guide</button>
            </div>
            <p className="mb-5 mt-3 text-sm text-gray-500 dark:text-gray-400">{article.summary}</p>
            <Blocks blocks={article.blocks} />
            {slug && <Link to="/help" className="mt-6 inline-block text-sm font-medium text-brand-500 hover:text-brand-600">All articles</Link>}
          </> : <>
            <h2 id="help-article-title" className="text-xl font-bold text-gray-800 dark:text-white/90">That article does not exist</h2>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">It may have been renamed. <Link to="/help" className="text-brand-500 hover:text-brand-600">Back to the help centre</Link>.</p>
          </>}
        </article>
        <section className={`asset-help-walkthrough ${card}`} aria-label="First-time walkthrough">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="text-theme-xs font-semibold uppercase tracking-wide text-brand-500">Optional onboarding</p><h2 className="mt-1 text-lg font-semibold text-gray-800 dark:text-white/90">First-time walkthrough</h2><p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Learn the flow without changing records. Progress is saved in this browser.</p></div>
            <button type="button" onClick={() => setWalkthroughOpen((open) => !open)} aria-expanded={walkthroughOpen} className={button}>{walkthroughOpen ? "Hide walkthrough" : "Open walkthrough"}</button>
          </div>
          {walkthroughOpen && <div className="mt-5 border-t border-gray-100 pt-5 dark:border-gray-800">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-500">Step {stepIndex + 1} of {steps.length}</p>
            <h3 className="mt-2 text-base font-semibold text-gray-800 dark:text-white/90">{activeStep.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-300">{activeStep.description}</p>
            {activeStep.href && <Link to={activeStep.href} className="mt-4 inline-block text-sm font-medium text-brand-500 hover:text-brand-600">{activeStep.label} →</Link>}
            <div className="mt-5 flex flex-wrap gap-2">
              <button type="button" disabled={stepIndex === 0} onClick={() => saveStep(stepIndex - 1)} className={`${button} disabled:opacity-50`}>Back</button>
              {stepIndex < steps.length - 1 ? <button type="button" onClick={() => saveStep(stepIndex + 1)} className="rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white">Next step</button> : <button type="button" onClick={() => saveStep(stepIndex, true)} className="rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white">Finish walkthrough</button>}
              <button type="button" onClick={() => saveStep(0)} className={button}>Restart tutorial</button>
            </div>
            {complete && <p role="status" className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-700 dark:bg-green-500/10 dark:text-green-400">Walkthrough complete. The guides remain available whenever you need them.</p>}
          </div>}
        </section>
        <button type="button" onClick={start} className="text-sm font-medium text-brand-500 hover:text-brand-600">Replay the guided tour</button>
      </div>
    </div>
  </div>;
}
