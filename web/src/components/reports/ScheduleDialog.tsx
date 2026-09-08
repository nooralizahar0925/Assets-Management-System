import { useState, type FormEvent } from "react";
import { Modal } from "../ui/modal";
import Label from "../form/Label";
import Input from "../form/input/InputField";
import { reportsApi } from "../../api/reports";
import { ApiError } from "../../api/client";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const selectClass =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm " +
  "text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 " +
  "focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

interface Props {
  savedReportId: string;
  isOpen: boolean;
  onClose: () => void;
  onDone: () => void;
}

export default function ScheduleDialog({ savedReportId, isOpen, onClose, onDone }: Props) {
  const [format, setFormat] = useState<"pdf" | "xlsx" | "csv" | "png">("pdf");
  const [cadence, setCadence] = useState<"daily" | "weekly" | "monthly">("weekly");
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [hour, setHour] = useState(8);
  const [recipients, setRecipients] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await reportsApi.schedule({
        saved_report_id: savedReportId,
        format, cadence,
        day_of_week: cadence === "weekly" ? dayOfWeek : null,
        day_of_month: cadence === "monthly" ? dayOfMonth : null,
        hour_utc: hour,
        recipients: recipients.split(/[,\s]+/).map((r) => r.trim()).filter(Boolean),
        active: true,
      });
      onDone();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.problem.detail ?? err.message
          : "Could not create the schedule.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-lg p-6">
      <h3 className="mb-1 text-lg font-medium text-gray-800 dark:text-white/90">
        Email this report on a schedule
      </h3>
      <p className="mb-5 text-sm text-gray-500 dark:text-gray-400">
        The report is generated and sent as an attachment. Times are UTC.
      </p>

      <form onSubmit={onSubmit} className="space-y-4">
        {error && (
          <div role="alert" className="rounded-lg border border-error-500 bg-error-50 px-3 py-2 text-sm text-error-600 dark:bg-error-500/10">
            {error}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="schedule-format">Format</Label>
            <select
              id="schedule-format" className={selectClass} value={format}
              onChange={(e) => setFormat(e.target.value as typeof format)}
            >
              <option value="pdf">PDF</option>
              <option value="xlsx">Excel</option>
              <option value="csv">CSV</option>
              <option value="png">Chart image</option>
            </select>
          </div>
          <div>
            <Label htmlFor="schedule-cadence">How often</Label>
            <select
              id="schedule-cadence" className={selectClass} value={cadence}
              onChange={(e) => setCadence(e.target.value as typeof cadence)}
            >
              <option value="daily">Every day</option>
              <option value="weekly">Every week</option>
              <option value="monthly">Every month</option>
            </select>
          </div>

          {cadence === "weekly" && (
            <div>
              <Label htmlFor="schedule-dow">Day</Label>
              <select
                id="schedule-dow" className={selectClass} value={dayOfWeek}
                onChange={(e) => setDayOfWeek(Number(e.target.value))}
              >
                {DAYS.map((day, index) => (
                  <option key={day} value={index}>{day}</option>
                ))}
              </select>
            </div>
          )}

          {cadence === "monthly" && (
            <div>
              <Label htmlFor="schedule-dom">Day of month</Label>
              <Input
                id="schedule-dom" type="number" min="1" max="28"
                value={String(dayOfMonth)}
                onChange={(e) => setDayOfMonth(Number(e.target.value))}
              />
              <p className="mt-1 text-theme-xs text-gray-400">
                1–28, so the schedule fires in February too.
              </p>
            </div>
          )}

          <div>
            <Label htmlFor="schedule-hour">Hour (UTC)</Label>
            <Input
              id="schedule-hour" type="number" min="0" max="23"
              value={String(hour)}
              onChange={(e) => setHour(Number(e.target.value))}
            />
          </div>
        </div>

        <div>
          <Label htmlFor="schedule-recipients">Send to</Label>
          <Input
            id="schedule-recipients" type="text" value={recipients}
            placeholder="ops@example.com, finance@example.com"
            onChange={(e) => setRecipients(e.target.value)}
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button" onClick={onClose}
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700"
          >
            Cancel
          </button>
          <button
            type="submit" disabled={saving}
            className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Create schedule"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
