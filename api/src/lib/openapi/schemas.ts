import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZodTypeAny } from "zod";
import { AssetInput } from "../domain/assets";
import { CheckOutInput, CheckInInput } from "../domain/assignments";
import { CategoryInput } from "../domain/categories";
import { LocationInput } from "../domain/locations";
import { SessionInput as StocktakeInput } from "../domain/stocktake";
import { ScheduleInput, ServiceInput } from "../domain/maintenance";
import { WebhookInput } from "../domain/webhooks";

/**
 * Request schemas, generated from the same Zod objects the handlers parse.
 *
 * Hand-written API documentation drifts within a month: a field is added, the
 * document is not updated, and an integrator builds against something that no
 * longer exists. These cannot drift, because there is only one definition.
 */

const REGISTRY: Record<string, ZodTypeAny> = {
  AssetInput,
  CheckOutInput,
  CheckInInput,
  CategoryInput,
  LocationInput,
  StocktakeSessionInput: StocktakeInput,
  MaintenanceScheduleInput: ScheduleInput,
  MaintenanceServiceInput: ServiceInput,
  WebhookInput,
};

/** Everything an error can look like. One shape, documented once. */
const PROBLEM = {
  type: "object",
  description:
    "RFC 9457 problem document. Every failure uses this shape, so a client "
    + "can handle errors in one place rather than per endpoint.",
  properties: {
    type: { type: "string", description: "A stable identifier for the error." },
    title: { type: "string" },
    status: { type: "integer" },
    detail: { type: "string" },
    errors: {
      type: "array",
      description: "Field-level failures, present on validation problems.",
      items: {
        type: "object",
        properties: {
          field: { type: "string" },
          message: { type: "string" },
        },
      },
    },
  },
  required: ["type", "title", "status"],
} as const;

const PAGINATION_META = {
  type: "object",
  properties: {
    page: { type: "integer" },
    per_page: { type: "integer" },
    total: { type: "integer" },
    total_pages: { type: "integer" },
  },
  required: ["page", "per_page", "total", "total_pages"],
} as const;

export function buildSchemas(): Record<string, unknown> {
  const schemas: Record<string, unknown> = {
    Problem: PROBLEM,
    PaginationMeta: PAGINATION_META,
  };

  for (const [name, schema] of Object.entries(REGISTRY)) {
    // `$refStrategy: "none"` inlines definitions: OpenAPI components cannot
    // resolve zod-to-json-schema's own `$defs`, and a document with dangling
    // references fails in every generator that consumes it.
    schemas[name] = zodToJsonSchema(schema, {
      target: "openApi3",
      $refStrategy: "none",
    });
  }

  return schemas;
}
