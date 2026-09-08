import { useEffect, useState, type FormEvent } from "react";
import { Modal } from "../ui/modal";
import Label from "../form/Label";
import Input from "../form/input/InputField";
import TextArea from "../form/input/TextArea";
import { assetsApi } from "../../api/assets";
import { catalogApi } from "../../api/catalog";
import { ApiError } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import type { LocationNode, OrgUser } from "../../api/types";

type AssigneeType = "user" | "location" | "external";

const selectClass =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm " +
  "text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 " +
  "focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

interface Props {
  assetId: string;
  isOpen: boolean;
  onClose: () => void;
  onDone: () => void;
}

export default function CheckOutDialog({ assetId, isOpen, onClose, onDone }: Props) {
  const [type, setType] = useState<AssigneeType>("user");
  const [userId, setUserId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [label, setLabel] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [note, setNote] = useState("");
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [locations, setLocations] = useState<LocationNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    if (!isOpen) return;
    void Promise.all([catalogApi.users(), catalogApi.locations()])
      .then(([u, l]) => {
  // A branch-scoped person may only send an asset somewhere they can still see
  // it afterwards; the API refuses the rest anyway.
        const visible = user?.location_scope
          ? l.filter((location) => user.location_scope!.includes(location.id))
          : l;
        setUsers(u);
        setLocations(visible);
        if (u.length && !userId) setUserId(u[0].id);
        if (visible.length && !locationId) setLocationId(visible[0].id);
      })
      .catch(() => undefined);
  }, [isOpen, user]); // eslint-disable-line react-hooks/exhaustive-deps

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await assetsApi.checkOut(assetId, {
        assignee_type: type,
        assignee_id: type === "user" ? userId : null,
        assignee_label: type === "external" ? label : null,
        location_id: type === "location" ? locationId : null,
        // The API wants a timestamp; a date input gives a date. End of that day
        // is what "due back on the 31st" means to a person.
        due_at: dueDate ? new Date(`${dueDate}T23:59:59Z`).toISOString() : null,
        note: note || null,
      });
      onDone();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.problem.detail ?? err.message
          : "Could not check out this asset.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-lg p-6">
      <h3 className="mb-1 text-lg font-medium text-gray-800 dark:text-white/90">
        Check out
      </h3>
      <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
        Record who is taking this asset and when it is due back.
      </p>

      <form onSubmit={onSubmit} className="space-y-4">
        {error && (
          <div role="alert" className="rounded-lg border border-error-500 bg-error-50 px-3 py-2 text-sm text-error-600 dark:bg-error-500/10">
            {error}
          </div>
        )}

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
            Assign to
          </legend>
          <div className="flex gap-4">
            {([
              ["user", "Person"], ["location", "Location"], ["external", "External"],
            ] as [AssigneeType, string][]).map(([option, optionLabel]) => (
              <label key={option} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="radio" name="assignee_type" value={option}
                  checked={type === option}
                  onChange={() => setType(option)}
                  className="h-4 w-4 border-gray-300 text-brand-500 focus:ring-brand-500"
                />
                {optionLabel}
              </label>
            ))}
          </div>
        </fieldset>

        {type === "user" && (
          <div>
            <Label htmlFor="checkout-user">Assign to</Label>
            <select
              id="checkout-user" className={selectClass}
              value={userId} onChange={(e) => setUserId(e.target.value)}
            >
              {users.map((user) => (
                <option key={user.id} value={user.id}>{user.name}</option>
              ))}
            </select>
          </div>
        )}

        {type === "location" && (
          <div>
            <Label htmlFor="checkout-location">Send to</Label>
            <select
              id="checkout-location" className={selectClass}
              value={locationId} onChange={(e) => setLocationId(e.target.value)}
            >
              {locations.map((location) => (
                <option key={location.id} value={location.id}>{location.path}</option>
              ))}
            </select>
          </div>
        )}

        {type === "external" && (
          <div>
            <Label htmlFor="checkout-label">Name</Label>
            <Input
              id="checkout-label" type="text" value={label}
              placeholder="Company or person outside the organisation"
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
        )}

        <div>
          <Label htmlFor="checkout-due">Due back</Label>
          <Input
            id="checkout-due" type="date" value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
          <p className="mt-1 text-theme-xs text-gray-400">
            Leave blank for an open-ended assignment. A due date enables overdue reminders.
          </p>
        </div>

        <div>
          <Label htmlFor="checkout-note">Note</Label>
          <TextArea value={note} onChange={setNote} rows={2} />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button" onClick={onClose}
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-white/[0.03]"
          >
            Cancel
          </button>
          <button
            type="submit" disabled={saving}
            className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {saving ? "Checking out…" : "Check out"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
