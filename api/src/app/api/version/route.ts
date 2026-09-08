import { safe } from "@/lib/http/handler";
import { getVersionInfo } from "@/lib/domain/releases";

/**
 * Which build this is, unauthenticated.
 *
 * A support conversation starts here: "what version are you on" should be
 * answerable by anyone who can reach the service, including a monitor that has
 * no credential. It reports the build and the schema head, nothing about any
 * organisation.
 */
export const GET = safe(async (_req: Request) =>
  Response.json(await getVersionInfo(), {
    headers: { "cache-control": "no-store" },
  }),
);
