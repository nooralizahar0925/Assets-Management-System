import { z } from "zod";
import { query } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, sessionCookie } from "@/lib/auth/session";
import { validationProblem, unauthorized } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";

const Body = z.object({ email: z.string().email(), password: z.string().min(1) });

interface UserRow {
  id: string;
  org_id: string;
  name: string;
  role: string;
  password_hash: string;
}

export const POST = safe(async (req: Request) => {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  // Pre-tenant lookup - the org is not known until the email resolves.
  const rows = await query<UserRow>(
    "SELECT * FROM auth_lookup_user_by_email($1)",
    [parsed.data.email],
  );
  const user = rows[0];
  if (!user || !(await verifyPassword(parsed.data.password, user.password_hash))) {
    return unauthorized();
  }

  const sid = await createSession(user.id, user.org_id);
  return Response.json(
    { id: user.id, name: user.name, role: user.role, org_id: user.org_id },
    { headers: { "set-cookie": sessionCookie(sid) } },
  );
});
