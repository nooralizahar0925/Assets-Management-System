import { buildSchemas } from "./schemas";
import { WEBHOOK_EVENTS } from "../domain/webhooks";

/**
 * The published description of the v1 API.
 *
 * Assembled here rather than annotated across the route files: the document is
 * a contract, and a contract scattered over forty handlers is one nobody can
 * read end to end or diff between releases.
 */

interface Operation {
  operationId: string;
  summary: string;
  description?: string;
  tags: string[];
  parameters?: unknown[];
  requestBody?: unknown;
  responses: Record<string, unknown>;
}

type PathItem = Partial<Record<"get" | "post" | "patch" | "put" | "delete", Operation>>;

export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers: { url: string; description: string }[];
  tags: { name: string; description: string }[];
  security: Record<string, string[]>[];
  paths: Record<string, PathItem>;
  components: {
    securitySchemes: Record<string, unknown>;
    schemas: Record<string, unknown>;
    parameters: Record<string, unknown>;
    responses: Record<string, unknown>;
  };
}

const problemResponse = (description: string) => ({
  description,
  content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } },
});

/**
 * Every operation can be refused for want of a credential, for want of a
 * permission, or for going too fast. Documenting them once here rather than
 * per operation is what keeps them from being forgotten on the next endpoint.
 */
const COMMON_ERRORS = {
  401: { $ref: "#/components/responses/Unauthorized" },
  403: { $ref: "#/components/responses/Forbidden" },
  429: { $ref: "#/components/responses/RateLimited" },
} as const;

const VALIDATION = { 422: { $ref: "#/components/responses/ValidationFailed" } } as const;
const NOT_FOUND = { 404: { $ref: "#/components/responses/NotFound" } } as const;

const json = (schema: unknown) => ({ content: { "application/json": { schema } } });

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

const body = (name: string, required = true) => ({
  required,
  content: { "application/json": { schema: ref(name) } },
});

const listResponse = (description: string) => ({
  description,
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: {
          data: { type: "array", items: { type: "object" } },
          meta: { $ref: "#/components/schemas/PaginationMeta" },
        },
      },
    },
  },
});

const okObject = (description: string) => ({ description, ...json({ type: "object" }) });

/** Only on the writes that actually honour it - see withIdempotency. */
const IDEMPOTENCY_KEY = {
  name: "Idempotency-Key",
  in: "header",
  required: false,
  schema: { type: "string", maxLength: 255 },
  description:
    "Repeat a request safely. The first response is stored for 24 hours and "
    + "replayed for any retry using the same key, marked with an "
    + "Idempotent-Replay header.",
};

const pathId = {
  name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" },
};

export function buildOpenApiDocument(): OpenApiDocument {
  const paths: Record<string, PathItem> = {
    "/assets": {
      get: {
        operationId: "listAssets",
        summary: "List and search the register",
        tags: ["Assets"],
        parameters: [
          { name: "q", in: "query", schema: { type: "string" },
            description: "Free-text search over name, tag and serial number." },
          { name: "status", in: "query",
            schema: { type: "array", items: { type: "string" } },
            description: "Repeatable. Any of available, in_use, maintenance, retired, lost." },
          { name: "category_id", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "location_id", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "assignee_id", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "sort", in: "query", schema: { type: "string" },
            description: "Field name, prefixed with - for descending." },
          { name: "page", in: "query", schema: { type: "integer", minimum: 1 } },
          { name: "per_page", in: "query", schema: { type: "integer", maximum: 200 } },
        ],
        responses: {
          200: listResponse("A page of assets."),
          ...COMMON_ERRORS, ...VALIDATION,
        },
      },
      post: {
        operationId: "createAsset",
        summary: "Add an asset",
        tags: ["Assets"],
        parameters: [IDEMPOTENCY_KEY],
        requestBody: body("AssetInput"),
        responses: {
          201: okObject("The asset as stored."),
          409: problemResponse("An asset with that tag or serial number exists."),
          ...COMMON_ERRORS, ...VALIDATION,
        },
      },
    },
    "/assets/{id}": {
      get: {
        operationId: "getAsset", summary: "Read one asset", tags: ["Assets"],
        parameters: [pathId],
        responses: {
          200: okObject("The asset."), ...NOT_FOUND, ...COMMON_ERRORS, ...VALIDATION,
        },
      },
      patch: {
        operationId: "updateAsset", summary: "Change an asset", tags: ["Assets"],
        parameters: [pathId],
        requestBody: body("AssetInput"),
        responses: {
          200: okObject("The asset as stored."),
          ...NOT_FOUND, ...COMMON_ERRORS, ...VALIDATION,
        },
      },
      delete: {
        operationId: "deleteAsset",
        summary: "Retire an asset",
        description: "A soft delete: the asset leaves the register but its history stays.",
        tags: ["Assets"],
        parameters: [pathId],
        responses: { 204: { description: "Removed." }, ...NOT_FOUND, ...COMMON_ERRORS },
      },
    },
    "/assets/{id}/checkout": {
      post: {
        operationId: "checkOutAsset", summary: "Issue an asset", tags: ["Custody"],
        parameters: [pathId, IDEMPOTENCY_KEY],
        requestBody: body("CheckOutInput"),
        responses: {
          201: okObject("The open assignment."),
          409: problemResponse("The asset cannot be issued from its current status."),
          ...NOT_FOUND, ...COMMON_ERRORS, ...VALIDATION,
        },
      },
    },
    "/assets/{id}/checkin": {
      post: {
        operationId: "checkInAsset", summary: "Receive an asset back", tags: ["Custody"],
        parameters: [pathId],
        requestBody: body("CheckInInput"),
        responses: {
          200: okObject("The closed assignment."),
          409: problemResponse("The asset is not currently issued."),
          ...NOT_FOUND, ...COMMON_ERRORS, ...VALIDATION,
        },
      },
    },
    "/assets/{id}/history": {
      get: {
        operationId: "listAssetHistory",
        summary: "Every recorded change to an asset",
        tags: ["Assets"],
        parameters: [pathId],
        responses: {
          200: listResponse("Audit events, newest first."),
          ...NOT_FOUND, ...COMMON_ERRORS, ...VALIDATION,
        },
      },
    },
    "/assets/lookup": {
      get: {
        operationId: "lookupAssetByTag",
        summary: "Find an asset by its printed tag",
        description: "What a scanned QR code or barcode resolves against.",
        tags: ["Assets"],
        parameters: [
          { name: "tag", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: {
          200: okObject("The asset."), ...NOT_FOUND, ...COMMON_ERRORS, ...VALIDATION,
        },
      },
    },
    "/categories": {
      get: {
        operationId: "listCategories", summary: "List categories", tags: ["Catalogue"],
        responses: { 200: listResponse("Categories."), ...COMMON_ERRORS, ...VALIDATION },
      },
      post: {
        operationId: "createCategory", summary: "Add a category", tags: ["Catalogue"],
        requestBody: body("CategoryInput"),
        responses: { 201: okObject("The category."), ...COMMON_ERRORS, ...VALIDATION },
      },
    },
    "/locations": {
      get: {
        operationId: "listLocations", summary: "List locations", tags: ["Catalogue"],
        responses: { 200: listResponse("Locations, as a flattened tree."), ...COMMON_ERRORS, ...VALIDATION },
      },
      post: {
        operationId: "createLocation", summary: "Add a location", tags: ["Catalogue"],
        requestBody: body("LocationInput"),
        responses: { 201: okObject("The location."), ...COMMON_ERRORS, ...VALIDATION },
      },
    },
    "/users": {
      get: {
        operationId: "listAssignableUsers",
        summary: "People an asset can be issued to",
        description:
          "Deliberately returns no email address or role: this is the check-out "
          + "picker, not a staff directory.",
        tags: ["Catalogue"],
        responses: { 200: listResponse("People."), ...COMMON_ERRORS, ...VALIDATION },
      },
    },
    "/imports": {
      post: {
        operationId: "importAssets",
        summary: "Import a spreadsheet",
        description:
          "Send the file as multipart field `file`. Without a `mapping` the "
          + "response describes the columns found and a suggested mapping. With "
          + "one, the import runs - as a dry run unless `dry_run=false`.",
        tags: ["Import"],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  file: { type: "string", format: "binary" },
                  category_id: { type: "string", format: "uuid" },
                  mapping: { type: "string", description: "JSON object of column to field." },
                  dry_run: { type: "string", enum: ["true", "false"] },
                },
                required: ["file"],
              },
            },
          },
        },
        responses: {
          200: okObject("A dry run, or the inspection of an unmapped file."),
          201: okObject("The committed import."),
          413: problemResponse("The file is larger than 10 MB."),
          ...COMMON_ERRORS, ...VALIDATION,
        },
      },
    },
    "/dashboard/summary": {
      get: {
        operationId: "getDashboardSummary",
        summary: "Headline figures for the register",
        tags: ["Reports"],
        responses: { 200: okObject("Totals, breakdowns and recent activity."), ...COMMON_ERRORS, ...VALIDATION },
      },
    },
    "/reports": {
      get: {
        operationId: "listReports",
        summary: "The report catalogue",
        tags: ["Reports"],
        responses: { 200: listResponse("Available reports."), ...COMMON_ERRORS, ...VALIDATION },
      },
    },
    "/reports/{key}": {
      get: {
        operationId: "runReport",
        summary: "Run a report",
        description:
          "One definition, six renderings. `format` chooses between json, csv, "
          + "xlsx, pdf, svg and png; the non-JSON formats return a file.",
        tags: ["Reports"],
        parameters: [
          { name: "key", in: "path", required: true, schema: { type: "string" } },
          { name: "format", in: "query",
            schema: { type: "string", enum: ["json", "csv", "xlsx", "pdf", "svg", "png"] } },
          { name: "category_id", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "location_id", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "from", in: "query", schema: { type: "string", format: "date" } },
          { name: "to", in: "query", schema: { type: "string", format: "date" } },
        ],
        responses: {
          200: okObject("The report, in the requested format."),
          ...NOT_FOUND, ...COMMON_ERRORS, ...VALIDATION,
        },
      },
    },
    "/stocktakes": {
      get: {
        operationId: "listStocktakes", summary: "Counting sessions", tags: ["Stock-take"],
        responses: { 200: listResponse("Sessions, newest first."), ...COMMON_ERRORS, ...VALIDATION },
      },
      post: {
        operationId: "openStocktake",
        summary: "Start a count",
        description:
          "Records what the register expects to be at the location, so an asset "
          + "moved mid-count is not reported missing.",
        tags: ["Stock-take"],
        requestBody: body("StocktakeSessionInput"),
        responses: { 201: okObject("The open session."), ...COMMON_ERRORS, ...VALIDATION },
      },
    },
    "/stocktakes/{id}": {
      get: {
        operationId: "getStocktake",
        summary: "A session and its reconciliation",
        tags: ["Stock-take"],
        parameters: [pathId],
        responses: { 200: okObject("Session and reconciliation."), ...NOT_FOUND, ...COMMON_ERRORS, ...VALIDATION },
      },
    },
    "/stocktakes/{id}/count": {
      post: {
        operationId: "countStocktakeItem",
        summary: "Record one scan",
        description:
          "Always answers 200. The outcome says what the scan was: expected, "
          + "unexpected, already_counted or unknown_tag.",
        tags: ["Stock-take"],
        parameters: [pathId],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { tag: { type: "string" } },
                required: ["tag"],
              },
            },
          },
        },
        responses: {
          200: okObject("What the scan turned out to be."),
          409: problemResponse("The session is closed."),
          ...NOT_FOUND, ...COMMON_ERRORS, ...VALIDATION,
        },
      },
    },
    "/stocktakes/{id}/close": {
      post: {
        operationId: "closeStocktake",
        summary: "Finish a count",
        description: "With `adjust: true`, whatever was not found is marked lost.",
        tags: ["Stock-take"],
        parameters: [pathId],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: { type: "object", properties: { adjust: { type: "boolean" } } },
            },
          },
        },
        responses: {
          200: okObject("How many assets were adjusted."),
          409: problemResponse("The session is already closed."),
          ...NOT_FOUND, ...COMMON_ERRORS, ...VALIDATION,
        },
      },
    },
    "/maintenance/schedules": {
      get: {
        operationId: "listMaintenanceSchedules",
        summary: "Service schedules",
        tags: ["Maintenance"],
        parameters: [
          { name: "asset_id", in: "query", schema: { type: "string", format: "uuid" } },
        ],
        responses: { 200: listResponse("Schedules."), ...COMMON_ERRORS, ...VALIDATION },
      },
      post: {
        operationId: "createMaintenanceSchedule",
        summary: "Schedule recurring work",
        description: "Recurs on elapsed days, on running hours, or both.",
        tags: ["Maintenance"],
        requestBody: body("MaintenanceScheduleInput"),
        responses: { 201: okObject("The schedule."), ...NOT_FOUND, ...COMMON_ERRORS, ...VALIDATION },
      },
    },
    "/maintenance/schedules/{id}/complete": {
      post: {
        operationId: "completeMaintenanceService",
        summary: "Record a completed service",
        description:
          "Rolls the next service forward from this date, not from the date it "
          + "was previously due.",
        tags: ["Maintenance"],
        parameters: [pathId],
        requestBody: body("MaintenanceServiceInput"),
        responses: { 200: okObject("The schedule, rolled forward."), ...NOT_FOUND, ...COMMON_ERRORS, ...VALIDATION },
      },
    },
    "/maintenance/services": {
      get: {
        operationId: "listMaintenanceServices",
        summary: "An asset's service history",
        tags: ["Maintenance"],
        parameters: [
          { name: "asset_id", in: "query", required: true,
            schema: { type: "string", format: "uuid" } },
        ],
        responses: { 200: listResponse("Services, newest first."), ...NOT_FOUND, ...COMMON_ERRORS, ...VALIDATION },
      },
    },
    "/webhooks": {
      get: {
        operationId: "listWebhooks",
        summary: "Subscribed endpoints",
        description: "Signing secrets are never returned here; only at creation.",
        tags: ["Webhooks"],
        responses: { 200: listResponse("Endpoints, and the events available."), ...COMMON_ERRORS, ...VALIDATION },
      },
      post: {
        operationId: "createWebhook",
        summary: "Subscribe an endpoint",
        description:
          `The response carries the signing secret. It is returned exactly once. `
          + `Deliveries are signed as sha256=<hmac> over the request body in the `
          + `X-AMS-Signature header. Events: ${WEBHOOK_EVENTS.join(", ")}.`,
        tags: ["Webhooks"],
        requestBody: body("WebhookInput"),
        responses: { 201: okObject("The endpoint, with its secret."), ...COMMON_ERRORS, ...VALIDATION },
      },
    },
    "/webhooks/{id}": {
      delete: {
        operationId: "deleteWebhook", summary: "Remove an endpoint", tags: ["Webhooks"],
        parameters: [pathId],
        responses: { 204: { description: "Removed." }, ...NOT_FOUND, ...COMMON_ERRORS },
      },
    },
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "Assets Management System API",
      version: "1.0.0",
      description:
        "Every response is JSON. Every failure is an RFC 9457 problem document, "
        + "so errors can be handled in one place. Authenticate with an API key as "
        + "a bearer token; browser sessions use a cookie and are not part of this "
        + "contract.",
    },
    servers: [
      { url: "/api/v1", description: "This deployment." },
    ],
    tags: [
      { name: "Assets", description: "The register itself." },
      { name: "Custody", description: "Who has what, and when it is due back." },
      { name: "Catalogue", description: "Categories, locations and people." },
      { name: "Import", description: "Bringing an existing register in." },
      { name: "Reports", description: "Figures, in six formats." },
      { name: "Stock-take", description: "Counting what is actually there." },
      { name: "Maintenance", description: "Recurring service and its history." },
      { name: "Webhooks", description: "Being told when something happens." },
    ],
    security: [{ ApiKey: [] }],
    paths,
    components: {
      securitySchemes: {
        ApiKey: {
          type: "http",
          scheme: "bearer",
          description:
            "An API key, created under Settings. Scoped to what it may do and "
            + "rate limited per key.",
        },
      },
      schemas: buildSchemas(),
      parameters: {},
      responses: {
        Unauthorized: problemResponse("No credential, or one that is not valid."),
        Forbidden: problemResponse(
          "The credential lacks the permission, or the resource is outside its branches.",
        ),
        NotFound: problemResponse("No such resource in this organisation."),
        ValidationFailed: problemResponse(
          "The request did not validate. `errors` names the fields.",
        ),
        RateLimited: problemResponse(
          "Too many requests for this key. Retry-After says how long to wait.",
        ),
      },
    },
  };
}
