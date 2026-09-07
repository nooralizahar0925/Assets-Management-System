import { safe } from "@/lib/http/handler";
import { buildOpenApiDocument } from "@/lib/openapi/document";

/**
 * The API's own description, unauthenticated on purpose.
 *
 * An integrator needs to read the contract before they have a key - that is
 * how they decide whether to build against it at all. The document describes
 * shapes, not data: there is nothing here that belongs to any organisation.
 */
export const GET = safe(async (_req: Request) =>
  Response.json(buildOpenApiDocument(), {
    headers: {
      // The document only changes when the code does, so it is worth caching -
      // but not for so long that a client keeps a stale contract after a
      // deploy.
      "cache-control": "public, max-age=300",
    },
  }),
);
