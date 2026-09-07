import type { FieldDef } from "../../api/types";

const CORE_FIELDS: { value: string; label: string }[] = [
  { value: "name", label: "Name (required)" },
  { value: "asset_tag", label: "Asset tag" },
  { value: "serial_no", label: "Serial number" },
  { value: "status", label: "Status" },
  { value: "description", label: "Description" },
  { value: "purchase_date", label: "Purchase date" },
  { value: "purchase_cost", label: "Purchase cost" },
  { value: "currency", label: "Currency" },
];

const selectClass =
  "h-10 w-full rounded-lg border border-gray-300 bg-transparent px-3 text-sm " +
  "text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 " +
  "focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

interface Props {
  headers: string[];
  sample: Record<string, string>[];
  schema: FieldDef[];
  value: Record<string, string>;
  onChange: (header: string, target: string) => void;
}

export default function MappingStep({ headers, sample, schema, value, onChange }: Props) {
  const nameMapped = Object.values(value).includes("name");

  return (
    <div className="space-y-4">
      {!nameMapped && (
        <div role="alert" className="rounded-lg border border-warning-500 bg-warning-50 px-4 py-3 text-sm text-warning-600 dark:bg-warning-500/10">
          Map one column to <strong>Name</strong> — every asset needs one, and rows
          without it will be skipped.
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800">
        <table className="min-w-full">
          <thead className="bg-gray-50 dark:bg-white/[0.03]">
            <tr>
              {["Column in your file", "First value", "Import as"].map((label) => (
                <th
                  key={label}
                  className="px-5 py-3 text-left text-theme-xs font-medium text-gray-500 dark:text-gray-400"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {headers.map((header) => (
              <tr key={header}>
                <td className="px-5 py-3 text-sm font-medium text-gray-800 dark:text-white/90">
                  {header}
                </td>
                <td className="max-w-[16rem] truncate px-5 py-3 text-sm text-gray-500 dark:text-gray-400">
                  {sample[0]?.[header] || "—"}
                </td>
                <td className="px-5 py-3">
                  <select
                    aria-label={`Map ${header}`}
                    className={selectClass}
                    value={value[header] ?? ""}
                    onChange={(e) => onChange(header, e.target.value)}
                  >
                    <option value="">Skip this column</option>
                    <optgroup label="Asset fields">
                      {CORE_FIELDS.map((field) => (
                        <option key={field.value} value={field.value}>{field.label}</option>
                      ))}
                    </optgroup>
                    {schema.length > 0 && (
                      <optgroup label="Category fields">
                        {schema.map((field) => (
                          <option key={field.key} value={`custom.${field.key}`}>
                            {field.label}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
