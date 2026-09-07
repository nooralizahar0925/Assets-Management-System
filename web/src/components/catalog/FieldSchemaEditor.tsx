import { useState } from "react";
import Label from "../form/Label";
import Input from "../form/input/InputField";
import type { FieldDef } from "../../api/types";

const TYPES: FieldDef["type"][] = ["string", "number", "date", "boolean", "enum"];

const selectClass =
  "h-10 w-full rounded-lg border border-gray-300 bg-transparent px-3 text-sm " +
  "text-gray-800 focus:border-brand-300 focus:outline-hidden focus:ring-3 " +
  "focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90";

/** Server-side keys must be snake_case; deriving them removes a whole class of error. */
export const toKey = (label: string) =>
  label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);

/**
 * Keeps the raw text the person is typing. Round-tripping through the parsed
 * array eats the separator: "Windows," parses to ["Windows"], which renders
 * back as "Windows" and deletes the comma as soon as it is typed.
 */
function OptionsInput({
  id, options, onChange,
}: { id: string; options: string[]; onChange: (options: string[]) => void }) {
  const [raw, setRaw] = useState(options.join(", "));
  return (
    <Input
      id={id} type="text"
      placeholder="Windows 11, macOS, Ubuntu"
      value={raw}
      onChange={(e) => {
        setRaw(e.target.value);
        onChange(e.target.value.split(",").map((o) => o.trim()).filter(Boolean));
      }}
    />
  );
}

interface Props {
  fields: FieldDef[];
  onChange: (fields: FieldDef[]) => void;
}

export default function FieldSchemaEditor({ fields, onChange }: Props) {
  const duplicates = fields
    .map((f) => f.key)
    .filter((key, index, all) => key && all.indexOf(key) !== index);

  const update = (index: number, patch: Partial<FieldDef>) =>
    onChange(fields.map((field, i) => (i === index ? { ...field, ...patch } : field)));

  return (
    <div className="space-y-4">
      {duplicates.length > 0 && (
        <div role="alert" className="rounded-lg border border-error-500 bg-error-50 px-3 py-2 text-sm text-error-600 dark:bg-error-500/10">
          Field keys must be unique — <strong>{duplicates.join(", ")}</strong> is used
          more than once.
        </div>
      )}

      {fields.length === 0 && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No custom fields yet. Add the details this kind of asset needs — warranty dates
          for IT, running hours for plant, licence expiry for media.
        </p>
      )}

      {fields.map((field, index) => (
        <div
          key={index}
          className="rounded-xl border border-gray-200 p-4 dark:border-gray-800"
        >
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <Label htmlFor={`field-label-${index}`}>Label</Label>
              <Input
                id={`field-label-${index}`} type="text" value={field.label}
                onChange={(e) => {
                  const label = e.target.value;
                  // Keep the key in step with the label while it is still the
                  // derived one. Testing `field.key ||` instead freezes the key
                  // at the first character, because it is truthy from then on.
                  // A key that no longer matches its label was set deliberately
                  // or is already stored, so it is left alone.
                  const derived = !field.key || field.key === toKey(field.label);
                  update(index, { label, key: derived ? toKey(label) : field.key });
                }}
              />
            </div>
            <div>
              <Label htmlFor={`field-type-${index}`}>Type</Label>
              <select
                id={`field-type-${index}`} className={selectClass} value={field.type}
                onChange={(e) => update(index, {
                  type: e.target.value as FieldDef["type"],
                  options: e.target.value === "enum" ? field.options ?? [] : undefined,
                })}
              >
                {TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end justify-between gap-2">
              <label className="flex h-10 items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox" checked={field.required}
                  onChange={(e) => update(index, { required: e.target.checked })}
                  className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                />
                Required
              </label>
              <button
                type="button"
                onClick={() => onChange(fields.filter((_, i) => i !== index))}
                className="h-10 text-theme-xs text-gray-400 hover:text-error-500"
              >
                Remove
              </button>
            </div>
          </div>

          {field.type === "enum" && (
            <div className="mt-3">
              <Label htmlFor={`field-options-${index}`}>Options</Label>
              <OptionsInput
                id={`field-options-${index}`}
                options={field.options ?? []}
                onChange={(options) => update(index, { options })}
              />
              <p className="mt-1 text-theme-xs text-gray-400">
                Separate the choices with commas.
              </p>
            </div>
          )}

          <p className="mt-2 font-mono text-theme-xs text-gray-400">
            key: {field.key || "—"}
          </p>
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([
          ...fields,
          { key: "", label: "", type: "string", required: false },
        ])}
        className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-white/[0.03]"
      >
        Add field
      </button>
    </div>
  );
}
