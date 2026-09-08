import { useState } from "react";
import { matchPath, useLocation } from "react-router";
import HelpPanel from "./HelpPanel";
import { HELP_TOPICS, type HelpTopic } from "../../content/help/topics";

/**
 * The help topic for a URL.
 *
 * An exact key wins before any pattern is tried. Without that, `/assets/new`
 * matches the `/assets/:id` pattern - it is a perfectly good value for `:id` -
 * and somebody adding an asset would be told how to read an asset's history.
 * Among patterns, the one with the fewest parameters wins, so `/stocktakes/:id`
 * beats a hypothetical `/:a/:b`.
 */
export function topicForPath(pathname: string): HelpTopic | undefined {
  const exact = HELP_TOPICS[pathname];
  if (exact) return exact;

  const matches = Object.keys(HELP_TOPICS)
    .filter((pattern) => pattern.includes(":"))
    .filter((pattern) => matchPath({ path: pattern, end: true }, pathname))
    .sort((a, b) => {
      const params = (p: string) => p.split("/").filter((s) => s.startsWith(":")).length;
      return params(a) - params(b) || b.length - a.length;
    });

  return matches.length > 0 ? HELP_TOPICS[matches[0]] : undefined;
}

/** The ? in the page header. Renders nothing on a page with no topic. */
export default function HelpButton() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const topic = topicForPath(pathname);

  if (!topic) return null;

  return (
    <>
      <button
        type="button"
        data-tour="help"
        onClick={() => setOpen(true)}
        aria-label={`Help with ${topic.title}`}
        title="Help with this page"
        className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 text-sm font-medium text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:border-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.05]"
      >
        ?
      </button>
      {open && <HelpPanel topic={topic} onClose={() => setOpen(false)} />}
    </>
  );
}
