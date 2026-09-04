import { query } from "@/lib/db";

export async function GET() {
  let db = false;
  try {
    await query("SELECT 1");
    db = true;
  } catch {
    db = false;
  }
  return Response.json({ status: "ok", db }, { status: db ? 200 : 503 });
}
