import type { ReactNode } from "react";
import Button from "../ui/button/Button";

interface Props {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  icon?: ReactNode;
}

/**
 * An empty table is a dead end.
 *
 * Every empty state names the next action, so a new customer's first screen
 * tells them what to do instead of showing a grid with no rows and leaving
 * them to guess which of the buttons in the header is the one they want.
 */
export default function EmptyState({
  title, description, actionLabel, onAction, secondaryLabel, onSecondary, icon,
}: Props) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      {icon && <div className="text-gray-300 dark:text-gray-600">{icon}</div>}
      <h3 className="text-base font-semibold text-gray-900 dark:text-white">
        {title}
      </h3>
      <p className="max-w-md text-sm text-gray-500 dark:text-gray-400">
        {description}
      </p>
      {(actionLabel || secondaryLabel) && (
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {actionLabel && onAction && (
            <Button size="sm" variant="primary" onClick={onAction}>
              {actionLabel}
            </Button>
          )}
          {secondaryLabel && onSecondary && (
            <Button size="sm" variant="outline" onClick={onSecondary}>
              {secondaryLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
