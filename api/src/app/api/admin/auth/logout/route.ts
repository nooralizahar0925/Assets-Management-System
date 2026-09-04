import { destroySession, clearSessionCookie } from "@/lib/auth/session";
import { safe } from "@/lib/http/handler";

export const POST = safe(async (req: Request) => {
  await destroySession(req);
  return new Response(null, {
    status: 204,
    headers: { "set-cookie": clearSessionCookie() },
  });
});
