import { useCallback, useEffect, useState } from "react";
import ComponentCard from "../common/ComponentCard";
import Badge from "../ui/badge/Badge";
import Label from "../form/Label";
import Input from "../form/input/InputField";
import TextArea from "../form/input/TextArea";
import { Modal } from "../ui/modal";
import { useModal } from "../../hooks/useModal";
import { useAuth } from "../../context/AuthContext";
import {
  maintenanceApi, describeDue, daysUntilDue,
  type MaintenanceSchedule, type MaintenanceEvent,
} from "../../api/maintenance";
import { ApiError } from "../../api/client";
import { formatDate } from "../../lib/datetime";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * An asset's service schedules and what has been done to it.
 *
 * Recording a service is the action that matters here: it is what stops the
 * reminders and rolls the next one forward, and it happens at the machine
 * rather than at a desk.
 */
export default function AssetMaintenance({ assetId }: { assetId: string }) {
  const { can } = useAuth();
  const dialog = useModal();
  const [schedules, setSchedules] = useState<MaintenanceSchedule[]>([]);
  const [history, setHistory] = useState<MaintenanceEvent[]>([]);
  const [completing, setCompleting] = useState<MaintenanceSchedule | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The service form
  const [at, setAt] = useState(today());
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");
  const [cost, setCost] = useState("");

  // The new-schedule form
  const [description, setDescription] = useState("");
  const [everyDays, setEveryDays] = useState("");
  const [everyHours, setEveryHours] = useState("");

  const canRead = can("maintenance:read");
  const canWrite = can("maintenance:write");

  const load = useCallback(() => {
    if (!canRead) return;
    void maintenanceApi.schedules(assetId).then(setSchedules).catch(() => undefined);
    void maintenanceApi.services(assetId).then(setHistory).catch(() => undefined);
  }, [assetId, canRead]);

  useEffect(load, [load]);

  if (!canRead) return null;

  function openService(schedule: MaintenanceSchedule) {
    setCompleting(schedule);
    setAdding(false);
    setAt(today());
    setHours(schedule.current_hours === null ? "" : String(schedule.current_hours));
    setNote("");
    setCost("");
    setError(null);
    dialog.openModal();
  }

  function openNew() {
    setAdding(true);
    setCompleting(null);
    setDescription("");
    setEveryDays("");
    setEveryHours("");
    setError(null);
    dialog.openModal();
  }

  async function save() {
    setError(null);
    try {
      if (adding) {
        await maintenanceApi.createSchedule({
          asset_id: assetId,
          description,
          every_days: everyDays === "" ? null : Number(everyDays),
          every_hours: everyHours === "" ? null : Number(everyHours),
        });
      } else if (completing) {
        await maintenanceApi.complete(completing.id, {
          at,
          hours: hours === "" ? null : Number(hours),
          note: note || null,
          cost: cost === "" ? null : Number(cost),
        });
      }
      dialog.closeModal();
      load();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.problem.detail ?? err.message
          : "Could not save that.",
      );
    }
  }

  return (
    <>
      <ComponentCard
        title="Servicing"
        desc="What is scheduled, and what has been done."
      >
        {canWrite && (
          <div className="mb-4">
            <button
              type="button" onClick={openNew}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700"
            >
              Add a schedule
            </button>
          </div>
        )}

        {schedules.length === 0 ? (
          <p className="py-4 text-sm text-gray-500 dark:text-gray-400">
            No service schedule. This asset is not chased for maintenance.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {schedules.map((schedule) => {
              const days = daysUntilDue(schedule);
              return (
                <li key={schedule.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-white/90">
                      {schedule.description}
                    </p>
                    <p className="text-theme-xs text-gray-500 dark:text-gray-400">
                      Due {describeDue(schedule)}
                      {schedule.last_service_at
                        && ` · last done ${formatDate(schedule.last_service_at)}`}
                    </p>
                  </div>
                  {days !== null && days < 0 && (
                    <Badge color="error" size="sm">{Math.abs(days)} days overdue</Badge>
                  )}
                  {canWrite && (
                    <button
                      type="button" onClick={() => openService(schedule)}
                      className="ml-auto rounded-lg px-3 py-2 text-theme-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700"
                    >
                      Record a service
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {history.length > 0 && (
          <div className="mt-5 border-t border-gray-100 pt-4 dark:border-gray-800">
            <h4 className="mb-2 text-theme-xs font-medium uppercase tracking-wide text-gray-400">
              Service history
            </h4>
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {history.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-baseline gap-2 py-2">
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {formatDate(entry.serviced_at)}
                  </span>
                  {entry.note && (
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      {entry.note}
                    </span>
                  )}
                  {entry.hours !== null && (
                    <span className="text-theme-xs text-gray-400">
                      at {entry.hours} hours
                    </span>
                  )}
                  {entry.cost && (
                    <span className="ml-auto text-theme-xs text-gray-500 dark:text-gray-400">
                      {new Intl.NumberFormat("id-ID", {
                        style: "currency", currency: "IDR", maximumFractionDigits: 0,
                      }).format(Number(entry.cost))}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </ComponentCard>

      <Modal isOpen={dialog.isOpen} onClose={dialog.closeModal} className="max-w-lg p-6">
        <h3 className="mb-5 text-lg font-medium text-gray-800 dark:text-white/90">
          {adding ? "Add a service schedule" : "Record a service"}
        </h3>

        <div className="space-y-4">
          {error && (
            <div role="alert" className="rounded-lg border border-error-500 bg-error-50 px-3 py-2 text-sm text-error-600 dark:bg-error-500/10">
              {error}
            </div>
          )}

          {adding ? (
            <>
              <div>
                <Label htmlFor="schedule-description">What is the work</Label>
                <Input
                  id="schedule-description" type="text" value={description}
                  placeholder="500-hour service"
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="schedule-days">Every (days)</Label>
                  <Input
                    id="schedule-days" type="number" min="1" value={everyDays}
                    onChange={(e) => setEveryDays(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="schedule-hours">Every (running hours)</Label>
                  <Input
                    id="schedule-hours" type="number" min="1" value={everyHours}
                    onChange={(e) => setEveryHours(e.target.value)}
                  />
                </div>
              </div>
              <p className="text-theme-xs text-gray-400">
                One or both. A schedule with neither would never come due.
              </p>
            </>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="service-at">Serviced on</Label>
                  <Input
                    id="service-at" type="date" value={at}
                    onChange={(e) => setAt(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="service-hours">Meter reading</Label>
                  <Input
                    id="service-hours" type="number" min="0" value={hours}
                    onChange={(e) => setHours(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="service-cost">Cost</Label>
                <Input
                  id="service-cost" type="number" min="0" value={cost}
                  onChange={(e) => setCost(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="service-note">Note</Label>
                <TextArea value={note} onChange={setNote} rows={2} />
              </div>
              <p className="text-theme-xs text-gray-400">
                The next service is counted from this date, not from the date it
                was previously due.
              </p>
            </>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button" onClick={dialog.closeModal}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700"
            >
              Cancel
            </button>
            <button
              type="button" onClick={() => void save()}
              disabled={adding && !description.trim()}
              className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
