import { Link } from "react-router";

export interface OnboardingState {
  categories: number;
  assets: number;
  users: number;
  api_keys: number;
  imports: number;
  checkouts: number;
}

export interface ChecklistItem {
  id: string;
  label: string;
  to: string;
  done: boolean;
  /** The permission without which this step is not this person's to take. */
  needs: string;
}

/**
 * What is left to set up, for this person.
 *
 * Two rules. Completion is derived from the register, never from a stored
 * flag - a checklist that can disagree with reality tells a new customer they
 * have done something they have not. And the list is filtered by permission
 * rather than by role name, because roles here are tenant-owned and renameable:
 * keying on the string "admin" would break the moment a customer calls their
 * administrators something else, which they are free to do.
 */
export function checklistFor(
  can: (permission: string) => boolean,
  state: OnboardingState,
): ChecklistItem[] {
  const all: ChecklistItem[] = [
    {
      id: "create-category",
      label: "Create your first category",
      to: "/categories",
      needs: "categories:write",
      done: state.categories > 0,
    },
    {
      id: "add-assets",
      label: "Bring in your register",
      to: "/import",
      needs: "assets:import",
      done: state.imports > 0 || state.assets > 0,
    },
    {
      id: "check-out",
      label: "Check an asset out to someone",
      to: "/assets",
      needs: "custody:write",
      done: state.checkouts > 0,
    },
    {
      id: "invite-team",
      label: "Invite your colleagues",
      to: "/settings/users",
      needs: "users:write",
      // One user is the person who signed the organisation up. A second means
      // somebody was actually invited.
      done: state.users > 1,
    },
    {
      id: "connect-system",
      label: "Connect another system",
      to: "/settings/api-keys",
      needs: "api_keys:write",
      done: state.api_keys > 0,
    },
  ];

  return all.filter((item) => can(item.needs));
}

interface Props {
  can: (permission: string) => boolean;
  state: OnboardingState;
}

export default function OnboardingChecklist({ can, state }: Props) {
  const items = checklistFor(can, state);
  const done = items.filter((item) => item.done).length;

  // Once there is nothing left to do the checklist stops taking up the
  // dashboard, rather than sitting there permanently ticked.
  if (items.length === 0 || done === items.length) return null;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-800 dark:text-white/90">
          Getting set up
        </h3>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {done} of {items.length}
        </span>
      </div>

      <ul className="mt-4 space-y-2">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className={`flex h-5 w-5 items-center justify-center rounded-full border text-xs ${
                item.done
                  ? "border-success-500 bg-success-500 text-white"
                  : "border-gray-300 dark:border-gray-600"
              }`}
            >
              {item.done ? "✓" : ""}
            </span>
            {item.done ? (
              <span className="text-sm text-gray-400 line-through">{item.label}</span>
            ) : (
              <Link
                to={item.to}
                className="text-sm text-gray-700 hover:underline dark:text-gray-200"
              >
                {item.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
