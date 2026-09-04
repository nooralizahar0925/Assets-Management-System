import { z } from "zod";
import { requireAuth, isResponse } from "@/lib/auth/guard";
import { validationProblem, problem } from "@/lib/http/problem";
import { safe } from "@/lib/http/handler";
import { buildLabelSheet, LABEL_TEMPLATES } from "@/lib/domain/labels";

const Body = z.object({
  asset_ids: z.array(z.string().uuid()).min(1).max(500),
  symbology: z.enum(["qr", "code128"]).default("qr"),
  template: z.enum(["avery5160", "avery5163", "thermal50x25"]).default("avery5160"),
});

export const GET = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "labels:print");
  if (isResponse(ctx)) return ctx;
  // The catalogue, so the UI can offer real stock sizes rather than guesses.
  return Response.json({
    data: Object.entries(LABEL_TEMPLATES).map(([key, t]) => ({ key, ...t })),
  });
});

export const POST = safe(async (req: Request) => {
  const ctx = await requireAuth(req, "labels:print");
  if (isResponse(ctx)) return ctx;

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return validationProblem(parsed.error);

  try {
    const html = await buildLabelSheet(ctx, {
      assetIds: parsed.data.asset_ids,
      symbology: parsed.data.symbology,
      template: parsed.data.template,
    });
    // Served as a document the browser prints directly - no PDF round trip, and
    // the sheet is self-contained so it prints with no network access.
    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return problem(422, "validation", "Cannot build label sheet", {
      detail: (err as Error).message,
    });
  }
});
