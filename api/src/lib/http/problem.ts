import type { ZodError } from "zod";

const BASE = "https://ams.dev/errors/";

export function problem(
  status: number,
  type: string,
  title: string,
  extra: Record<string, unknown> = {},
): Response {
  return new Response(
    JSON.stringify({ type: BASE + type, title, status, ...extra }),
    { status, headers: { "content-type": "application/problem+json" } },
  );
}

export function validationProblem(error: ZodError): Response {
  return problem(422, "validation", "Validation failed", {
    errors: error.issues.map((i) => ({
      field: i.path.join(".") || "_",
      message: i.message,
    })),
  });
}

export function notFound(resource: string): Response {
  // Only the first letter is raised, so multi-word resources read as
  // "API key not found" rather than "Api Key Not Found". Callers pass the
  // resource already cased as they want it to appear, e.g. "API key".
  const title = resource.charAt(0).toUpperCase() + resource.slice(1) + " not found";
  return problem(404, "not-found", title);
}

export const unauthorized = () =>
  problem(401, "unauthorized", "Authentication required");

export const forbidden = (detail?: string) =>
  problem(403, "forbidden", "Forbidden", detail ? { detail } : {});

export const conflict = (detail: string) =>
  problem(409, "conflict", "Conflict", { detail });
