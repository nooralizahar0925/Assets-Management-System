import type { ChangeEvent, ReactNode } from "react";

/**
 * The console's own label and field.
 *
 * Not the shared ones from components/form. Those switch on Tailwind's `dark:`
 * variant, which follows the document theme - and the console is dark whatever
 * the document says, so on a customer in light mode they rendered gray-700 text
 * on a gray-800 card. The sign-in form was legible only to whoever happened to
 * be in dark mode.
 *
 * Kept deliberately small: the same three classes the rest of the console
 * writes inline, in one place, so a new screen has something obvious to reach
 * for that is not the wrong thing.
 */

export const FIELD_CLASS =
  "mt-1 h-11 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 text-sm "
  + "text-gray-100 placeholder:text-gray-500 focus:border-brand-500 "
  + "focus:outline-hidden disabled:opacity-50";

interface FieldProps {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  autoComplete?: string;
  /** Shown under the field: what to type, or why it cannot be changed. */
  hint?: ReactNode;
}

export default function Field({
  id, label, type = "text", value, onChange,
  placeholder, disabled, autoComplete, hint,
}: FieldProps) {
  return (
    <div>
      <label htmlFor={id} className="block text-theme-xs font-medium text-gray-300">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        className={FIELD_CLASS}
      />
      {hint && (
        <p className="mt-1 text-theme-xs text-gray-500">{hint}</p>
      )}
    </div>
  );
}
