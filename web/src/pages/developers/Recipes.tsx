import Prose from "../../components/developers/Prose";
import CodeTabs from "../../components/developers/CodeTabs";
import { RECIPES } from "../../content/recipes";

export default function Recipes() {
  return (
    <div>
      <Prose>
        <h1 className="text-title-sm font-bold text-gray-800 dark:text-white/90">
          Recipes
        </h1>
        <p>
          The eight flows most integrations need. Each is described once and
          rendered into four languages, so the tabs cannot disagree about the
          call they make. Set <code>AMS_KEY</code> in your environment before
          running any of them.
        </p>
      </Prose>

      {RECIPES.map((recipe) => (
        <section key={recipe.id} id={recipe.id} className="mt-8 scroll-mt-8">
          <h2 className="text-theme-lg font-semibold text-gray-800 dark:text-white/90">
            {recipe.title}
          </h2>
          <p className="mt-1 text-theme-sm text-gray-600 dark:text-gray-400">
            {recipe.blurb}
          </p>
          <CodeTabs request={recipe.request} />
          {recipe.note && (
            <p className="text-theme-xs text-gray-500 dark:text-gray-400">
              {recipe.note}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
