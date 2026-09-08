import { safe } from "@/lib/http/handler";
import {
  readPlatformCookie, endPlatformSession, clearPlatformCookie,
} from "@/lib/platform/auth";

/**
 * Ends the session for real, not just in the browser.
 *
 * The row is deleted rather than the cookie merely cleared, so a copy of the
 * cookie taken beforehand is worthless afterwards.
 */
export const POST = safe(async (req: Request) => {
  const sid = readPlatformCookie(req);
  if (sid) await endPlatformSession(sid);

  return new Response(null, {
    status: 204,
    headers: { "set-cookie": clearPlatformCookie() },
  });
});
