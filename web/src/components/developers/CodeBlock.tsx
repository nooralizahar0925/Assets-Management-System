import { useState } from "react";

/**
 * A block of code with a copy button.
 *
 * Deliberately not syntax-highlighted. A highlighter is a large dependency for
 * a handful of snippets, and colour that is nearly right on an unfamiliar
 * language reads worse than none at all.
 */
export default function CodeBlock({
  code, language, label,
}: { code: string; language?: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // A browser that refuses clipboard access is not worth an error message:
      // the code is on screen and can be selected.
    }
  }

  return (
    <figure className="my-4 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
      <figcaption className="flex items-center gap-3 border-b border-gray-200 bg-gray-50 px-4 py-2 dark:border-gray-800 dark:bg-white/[0.03]">
        <span className="text-theme-xs font-medium text-gray-500 dark:text-gray-400">
          {label ?? language ?? "Example"}
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          className="ml-auto rounded-md px-2 py-1 text-theme-xs font-medium text-gray-600 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-white/10"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </figcaption>
      <pre className="overflow-x-auto bg-white p-4 text-theme-xs leading-relaxed text-gray-800 dark:bg-gray-900 dark:text-gray-200">
        <code>{code}</code>
      </pre>
    </figure>
  );
}
