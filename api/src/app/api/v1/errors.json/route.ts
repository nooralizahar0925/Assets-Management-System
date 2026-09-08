import { safe } from "@/lib/http/handler";
import { ERROR_CATALOG, errorTypeUri } from "@/lib/http/catalog";

/**
 * Every error this API can return, with its cause and its remedy.
 *
 * Unauthenticated, and served with an absolute `type` for each entry - the
 * same URI a problem document carries. Somebody holding a failed response can
 * look up exactly the string in front of them rather than guessing which
 * documentation page it maps to.
 */
export const GET = safe(async (_req: Request) =>
  Response.json(
    {
      data: ERROR_CATALOG.map((entry) => ({
        ...entry,
        type: errorTypeUri(entry.slug),
      })),
    },
    { headers: { "cache-control": "public, max-age=300" } },
  ),
);
