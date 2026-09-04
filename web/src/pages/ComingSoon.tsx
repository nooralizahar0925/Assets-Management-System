import PageMeta from "../components/common/PageMeta";
import PageBreadCrumb from "../components/common/PageBreadCrumb";

/**
 * A placeholder for a screen a later task builds.
 *
 * Every route exists from the foundation task onward, so navigation, the
 * sidebar and RequireAuth are all exercisable before the pages behind them are
 * written. Each task replaces one of these with the real screen.
 */
export default function ComingSoon({ title }: { title: string }) {
  return (
    <>
      <PageMeta title={`${title} | Assets`} description={title} />
      <PageBreadCrumb pageTitle={title} />
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="mb-2 font-semibold text-gray-800 dark:text-white/90">
          {title}
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          This screen is not built yet.
        </p>
      </div>
    </>
  );
}
