export interface Pagination {
  page: number;
  perPage: number;
  offset: number;
}

// Number() would accept " 20 ", 0x14 and 1e3 as 20, 20 and 1000. A query
// parameter is text from a caller, so only plain digits count.
const DIGITS = /^\d+$/;

const int = (raw: string | null, fallback: number, min: number, max: number) => {
  if (!raw || !DIGITS.test(raw)) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(n) || n < min) return fallback;
  return Math.min(n, max);
};

export function parsePagination(url: URL): Pagination {
  const page = int(url.searchParams.get("page"), 1, 1, 1_000_000);
  const perPage = int(url.searchParams.get("per_page"), 50, 1, 200);
  return { page, perPage, offset: (page - 1) * perPage };
}

export interface Sort {
  column: string;
  direction: "ASC" | "DESC";
}

export function parseSort(
  url: URL,
  allowed: readonly string[],
  fallback: string,
): Sort {
  const raw = url.searchParams.get("sort") ?? "";
  const direction = raw.startsWith("-") ? "DESC" : "ASC";
  const column = raw.replace(/^-/, "");
  return allowed.includes(column)
    ? { column, direction }
    : { column: fallback, direction: "ASC" };
}

export function paginated<T>(
  data: T[],
  { page, perPage }: Pagination,
  total: number,
): Response {
  return Response.json({
    data,
    meta: {
      page,
      per_page: perPage,
      total,
      total_pages: Math.max(1, Math.ceil(total / perPage)),
    },
  });
}
