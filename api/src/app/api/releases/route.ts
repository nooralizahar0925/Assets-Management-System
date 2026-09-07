import { safe } from "@/lib/http/handler";
import { listReleases } from "@/lib/domain/releases";

/**
 * The public changelog.
 *
 * Unauthenticated because the notes describe the product, not any customer's
 * data, and somebody evaluating the system should be able to see what has been
 * shipped recently.
 */
export const GET = safe(async (_req: Request) =>
  Response.json({ data: await listReleases() }, {
    headers: { "cache-control": "public, max-age=300" },
  }),
);
