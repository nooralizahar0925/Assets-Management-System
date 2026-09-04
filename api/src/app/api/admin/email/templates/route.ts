import { z } from "zod";
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { validationProblem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { listTemplates, upsertTemplate } from "@/lib/email/templates";

const Body = z.object({
  key: z.string().min(1).max(80),
  subject: z.string().min(1).max(300),
  html_body: z.string().min(1),
  text_body: z.string().min(1),
});

export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "settings:write");
  if (isResponse(ctx)) return ctx;
  return Response.json({ data: await listTemplates(ctx) });
});

export const PUT = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "settings:write");
  if (isResponse(ctx)) return ctx;

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  const { key, ...template } = parsed.data;
  return Response.json(await upsertTemplate(ctx, key, template));
});
