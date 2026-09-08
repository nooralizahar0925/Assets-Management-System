import { api } from "./client";

/**
 * The two documents the developer portal is rendered from.
 *
 * Both are public and neither is tenant-scoped: the portal is read by people
 * evaluating the product before anyone has issued them a credential.
 */

export interface OpenApiOperation {
  operationId: string;
  summary: string;
  description?: string;
  tags: string[];
  parameters?: { name: string; in: string; required?: boolean; description?: string }[];
  requestBody?: unknown;
  responses: Record<string, { description?: string }>;
}

export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description: string };
  servers: { url: string; description: string }[];
  tags: { name: string; description: string }[];
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: {
    schemas?: Record<string, unknown>;
  };
}

/**
 * The events an endpoint can subscribe to, read out of the published document.
 *
 * The list lives in one place in the API and reaches the document through the
 * schema its handler parses, so a page rendering this cannot advertise an
 * event the server does not accept.
 */
export function webhookEventsIn(doc: OpenApiDocument): string[] {
  const schema = doc.components?.schemas?.WebhookInput as
    | { properties?: { events?: { items?: { enum?: unknown } } } }
    | undefined;
  const values = schema?.properties?.events?.items?.enum;
  return Array.isArray(values) ? values.map(String) : [];
}

export interface CatalogError {
  slug: string;
  status: number;
  title: string;
  when: string;
  fix: string;
  type: string;
}

export const developersApi = {
  openapi: () => api.get<OpenApiDocument>("/api/v1/openapi.json"),
  errors: () => api.get<CatalogError[]>("/api/v1/errors.json"),
};

/** HTTP methods, in the order a reader expects them, not alphabetically. */
const METHODS = ["get", "post", "put", "patch", "delete"] as const;

export interface ReferenceOperation extends OpenApiOperation {
  path: string;
  method: string;
}

export interface ReferenceGroup {
  name: string;
  description: string;
  operations: ReferenceOperation[];
}

/**
 * Flatten the document into the groups the reference renders.
 *
 * Grouping by tag rather than by path keeps related operations together —
 * `POST /assets/{id}/checkout` belongs beside `GET /assets`, not in a separate
 * section because its URL is longer. A tag the document declares but never
 * uses is dropped rather than rendered as an empty heading.
 */
export function groupByTag(doc: OpenApiDocument): ReferenceGroup[] {
  // OpenAPI paths are relative to the server URL, and ours is "/api/v1".
  // Printing the bare path puts "/assets" next to a GET - a URL that does not
  // exist - in the one document a reader is meant to copy from.
  const prefix = (doc.servers?.[0]?.url ?? "").replace(/\/$/, "");

  const operations: ReferenceOperation[] = [];
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const method of METHODS) {
      const operation = item[method];
      if (operation) {
        operations.push({ ...operation, path: `${prefix}${path}`, method });
      }
    }
  }

  const declared = doc.tags ?? [];
  const groups = declared.map((tag) => ({
    name: tag.name,
    description: tag.description,
    operations: operations.filter((op) => (op.tags ?? []).includes(tag.name)),
  }));

  // An operation whose tag was never declared would otherwise vanish from the
  // page entirely, which is worse than an ugly heading.
  const covered = new Set(declared.map((t) => t.name));
  const orphans = operations.filter(
    (op) => !(op.tags ?? []).some((tag) => covered.has(tag)),
  );
  if (orphans.length > 0) {
    groups.push({ name: "Other", description: "", operations: orphans });
  }

  return groups.filter((group) => group.operations.length > 0);
}
