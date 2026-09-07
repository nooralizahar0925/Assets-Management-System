import { useState } from "react";
import CodeBlock from "./CodeBlock";
import {
  renderCurl, renderFetch, renderPython, renderPhp, type HttpRequest,
} from "../../content/renderers";

const LANGUAGES = [
  { key: "curl", label: "cURL", render: renderCurl },
  { key: "js", label: "JavaScript", render: renderFetch },
  { key: "python", label: "Python", render: renderPython },
  { key: "php", label: "PHP", render: renderPhp },
] as const;

/** One flow, four languages, rendered from a single request description. */
export default function CodeTabs({ request }: { request: HttpRequest }) {
  const [active, setActive] = useState<string>(LANGUAGES[0].key);
  const current = LANGUAGES.find((l) => l.key === active) ?? LANGUAGES[0];

  return (
    <div className="my-4">
      <div role="tablist" aria-label="Language" className="flex gap-1">
        {LANGUAGES.map((language) => (
          <button
            key={language.key}
            type="button"
            role="tab"
            aria-selected={language.key === active}
            onClick={() => setActive(language.key)}
            className={`rounded-md px-3 py-1 text-theme-xs font-medium transition ${
              language.key === active
                ? "bg-brand-500 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-white/[0.05] dark:text-gray-400 dark:hover:bg-white/10"
            }`}
          >
            {language.label}
          </button>
        ))}
      </div>
      <CodeBlock label={current.label} code={current.render(request)} />
    </div>
  );
}
