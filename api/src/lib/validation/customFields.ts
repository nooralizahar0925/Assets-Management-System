import { z } from "zod";

export const FIELD_TYPES = ["string", "number", "date", "boolean", "enum"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: string[];
}
export interface FieldSchema {
  fields: FieldDef[];
}

const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

const FieldDefZ = z
  .object({
    key: z.string().regex(KEY_RE, "key must be snake_case, starting with a letter"),
    label: z.string().min(1).max(80),
    type: z.enum(FIELD_TYPES),
    required: z.boolean().default(false),
    options: z.array(z.string().min(1)).min(1).optional(),
  })
  .refine((f) => f.type !== "enum" || (f.options?.length ?? 0) > 0, {
    message: "enum fields must declare options",
    path: ["options"],
  });

export const FieldSchemaZ = z
  .object({ fields: z.array(FieldDefZ).max(50) })
  .refine((s) => new Set(s.fields.map((f) => f.key)).size === s.fields.length, {
    message: "field keys must be unique",
    path: ["fields"],
  });

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function zodForField(field: FieldDef): z.ZodTypeAny {
  switch (field.type) {
    case "string":  return z.string().max(2000);
    case "number":  return z.number().finite();
    case "boolean": return z.boolean();
    case "date":    return z.string().regex(ISO_DATE, "expected an ISO date (YYYY-MM-DD)");
    case "enum":    return z.enum(field.options as [string, ...string[]]);
  }
}

/**
 * Builds a validator for an asset's `custom` object from its category schema.
 * Unknown keys are stripped rather than rejected, so a category can drop a field
 * without breaking integrators that still send it.
 */
export function buildCustomValidator(
  schema: FieldSchema,
): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of schema.fields) {
    const base = zodForField(field);
    shape[field.key] = field.required ? base : base.optional().nullable();
  }
  return z.object(shape).strip() as z.ZodType<Record<string, unknown>>;
}
