export interface Pagination {
  page: number;
  perPage: number;
  offset: number;
}

const int = (raw: string | null, fallback: number, min: number, max: number) => {
  const n = Number(raw);
  if (!raw || !Number.isInteger(n) || n < min) return fallback;
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
