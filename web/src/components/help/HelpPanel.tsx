import { useEffect, useRef } from "react";
import { Link } from "react-router";
import { Blocks } from "../../content/help/blocks";
import { useTour } from "./TourProvider";
import type { HelpTopic } from "../../content/help/topics";

interface Props {
  topic: HelpTopic;
  onClose: () => void;
}

export default function HelpPanel({ topic, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const { start } = useTour();

  useEffect(() => {
    // Focus moves into the panel so a keyboard user is not left behind on the
    // page underneath, and Escape closes it like every other dialog.
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-gray-900/30"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={topic.title}
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto border-l border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900"
      >
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {topic.title}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close help"
            className="rounded-lg px-2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            ✕
          </button>
        </div>

        <Blocks blocks={topic.blocks} />

        <div className="mt-auto flex flex-col items-start gap-2 border-t border-gray-100 pt-4 dark:border-gray-800">
          {topic.article && (
            <Link
              to={`/help/${topic.article}`}
              onClick={onClose}
              className="text-sm font-medium text-brand-500 hover:text-brand-600"
            >
              Read the full article
            </Link>
          )}
          {/*
            The tour is offered here rather than only on first run: somebody who
            dismissed it on day one has no other way back to it, and "show me
            round again" is a thing people ask for out loud.
          */}
          <button
            type="button"
            onClick={() => { onClose(); start(); }}
            className="text-sm font-medium text-brand-500 hover:text-brand-600"
          >
            Replay the tour
          </button>
        </div>
      </aside>
    </>
  );
}
