import Label from "../form/Label";
import Input from "../form/input/InputField";
import type { FieldDef } from "../../api/types";

interface Props {
  schema: FieldDef[];
  value: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  errors: Record<string, string>;
}

const selectClass =
  "h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm " +
  "text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 " +
  "focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

export default function CustomFields({ schema, value, onChange, errors }: Props) {
  if (schema.length === 0) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        This category defines no additional fields. Add them under Categories to capture
        details specific to this kind of asset.
      </p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {schema.map((field) => {
        const id = `custom-${field.key}`;
        const error = errors[field.key] ?? errors[`custom.${field.key}`];
        const current = value[field.key];

        return (
          <div key={field.key}>
            <Label htmlFor={id}>
              {field.label}
              {field.required && <span className="text-error-500">*</span>}
            </Label>

            {field.type === "enum" ? (
              <select
                id={id}
                className={selectClass}
                required={field.required}
                value={String(current ?? "")}
                onChange={(e) => onChange(field.key, e.target.value || null)}
              >
                <option value="">Not set</option>
                {(field.options ?? []).map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            ) : field.type === "boolean" ? (
              <label className="flex h-11 items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  id={id}
                  type="checkbox"
                  checked={Boolean(current)}
                  onChange={(e) => onChange(field.key, e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                />
                Yes
              </label>
            ) : (
              <Input
                id={id}
                type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                value={current === null || current === undefined ? "" : String(current)}
                error={Boolean(error)}
                onChange={(e) => {
                  const raw = e.target.value;
                  // A number field must emit a number — the API rejects "16".
                  onChange(
                    field.key,
                    field.type === "number"
                      ? raw === "" ? null : Number(raw)
                      : raw === "" ? null : raw,
                  );
                }}
              />
            )}

            {error && <p className="mt-1 text-theme-xs text-error-500">{error}</p>}
          </div>
        );
      })}
    </div>
  );
}
