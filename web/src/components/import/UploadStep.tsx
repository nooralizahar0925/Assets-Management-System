import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import Label from "../form/Label";
import type { Category } from "../../api/types";

const selectClass =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm " +
  "text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 " +
  "focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

interface Props {
  categories: Category[];
  categoryId: string;
  onCategory: (id: string) => void;
  onFile: (file: File) => void;
  busy: boolean;
}

export default function UploadStep({
  categories, categoryId, onCategory, onFile, busy,
}: Props) {
  const [rejected, setRejected] = useState<string | null>(null);

  const onDrop = useCallback((accepted: File[], fileRejections: unknown[]) => {
    if (fileRejections.length > 0) {
      setRejected("That file type is not supported. Upload a .csv, .xlsx or .xls file.");
      return;
    }
    setRejected(null);
    if (accepted[0]) onFile(accepted[0]);
  }, [onFile]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxFiles: 1,
    maxSize: 10 * 1024 * 1024,
    accept: {
      "text/csv": [".csv"],
      "application/vnd.ms-excel": [".xls"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
    },
  });

  return (
    <div className="space-y-5">
      <div>
        <Label htmlFor="import-category">Category for the imported assets</Label>
        <select
          id="import-category" className={selectClass}
          value={categoryId} onChange={(e) => onCategory(e.target.value)}
        >
          <option value="">Uncategorised</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <p className="mt-1 text-theme-xs text-gray-400">
          Choosing a category lets you map spreadsheet columns onto its custom fields.
        </p>
      </div>

      <div
        {...getRootProps()}
        className={`cursor-pointer rounded-2xl border-2 border-dashed p-12 text-center transition ${
          isDragActive
            ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
            : "border-gray-300 hover:border-brand-400 dark:border-gray-700"
        }`}
      >
        <input {...getInputProps()} />
        <p className="text-sm font-medium text-gray-800 dark:text-white/90">
          {busy
            ? "Reading the file…"
            : isDragActive
              ? "Drop the file here"
              : "Drag a spreadsheet here, or click to choose one"}
        </p>
        <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">
          CSV, XLSX or XLS · up to 10 MB · nothing is saved until you confirm
        </p>
      </div>

      {rejected && (
        <p role="alert" className="rounded-lg bg-error-50 px-3 py-2 text-sm text-error-600 dark:bg-error-500/10">
          {rejected}
        </p>
      )}
    </div>
  );
}
