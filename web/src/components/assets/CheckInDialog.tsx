import { useEffect, useState, type FormEvent } from "react";
import { Modal } from "../ui/modal";
import Label from "../form/Label";
import TextArea from "../form/input/TextArea";
import { assetsApi } from "../../api/assets";
import { catalogApi } from "../../api/catalog";
import { ApiError } from "../../api/client";
import { useAuth } from "../../context/AuthContext";
import type { LocationNode } from "../../api/types";

const CONDITIONS = ["Good", "Fair", "Damaged", "Needs service"];

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

export default function CheckInDialog({ assetId, isOpen, onClose, onDone }: Props) {
  const [condition, setCondition] = useState("Good");
  const [locationId, setLocationId] = useState("");
  const [note, setNote] = useState("");
  const [locations, setLocations] = useState<LocationNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    if (!isOpen) return;
    void catalogApi.locations()
      .then((l) => {
  // A branch-scoped person may only send an asset somewhere they can still see
  // it afterwards; the API refuses the rest anyway.
        setLocations(
          user?.location_scope
            ? l.filter((location) => user.location_scope!.includes(location.id))
            : l,
        );
      })
      .catch(() => undefined);
  }, [isOpen, user]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await assetsApi.checkIn(assetId, {
        condition,
        location_id: locationId || null,
        note: note || null,
      });
      onDone();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.problem.detail ?? err.message
          : "Could not check in this asset.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-lg p-6">
      <h3 className="mb-1 text-lg font-medium text-gray-800 dark:text-white/90">
        Check in
      </h3>
      <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
        Record the asset's return and the condition it came back in.
      </p>

      <form onSubmit={onSubmit} className="space-y-4">
        {error && (
          <div role="alert" className="rounded-lg border border-error-500 bg-error-50 px-3 py-2 text-sm text-error-600 dark:bg-error-500/10">
            {error}
          </div>
        )}

        <div>
          <Label htmlFor="checkin-condition">Condition</Label>
          <select
            id="checkin-condition" className={selectClass}
            value={condition} onChange={(e) => setCondition(e.target.value)}
          >
            {CONDITIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor="checkin-location">Returned to</Label>
          <select
            id="checkin-location" className={selectClass}
            value={locationId} onChange={(e) => setLocationId(e.target.value)}
          >
            <option value="">Leave the location unchanged</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>{location.path}</option>
            ))}
          </select>
        </div>

        <div>
          <Label htmlFor="checkin-note">Note</Label>
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
            className="rounded-lg bg-success-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-success-600 disabled:opacity-50"
          >
            {saving ? "Checking in…" : "Check in"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
