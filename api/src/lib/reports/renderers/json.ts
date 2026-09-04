import type { ReportResult } from "../types";

export const renderJson = (result: ReportResult): Response =>
  Response.json({ data: result });
