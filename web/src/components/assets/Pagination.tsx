interface Props {
  meta: { page: number; per_page: number; total: number; total_pages: number };
  onPage: (page: number) => void;
}

export default function Pagination({ meta, onPage }: Props) {
  if (meta.total === 0) return null;
  const first = (meta.page - 1) * meta.per_page + 1;
  const last = Math.min(meta.page * meta.per_page, meta.total);

  const buttonClass =
    "rounded-lg px-3 py-2 text-sm font-medium text-gray-700 ring-1 ring-inset " +
    "ring-gray-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 " +
    "dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-white/[0.03]";

  return (
    <div className="flex items-center justify-between">
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Showing <strong>{first}</strong>–<strong>{last}</strong> of{" "}
        <strong>{meta.total.toLocaleString()}</strong>
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button" className={buttonClass}
          disabled={meta.page <= 1}
          onClick={() => onPage(meta.page - 1)}
        >
          Previous
        </button>
        <span className="text-sm text-gray-500 dark:text-gray-400">
          Page {meta.page} of {meta.total_pages}
        </span>
        <button
          type="button" className={buttonClass}
          disabled={meta.page >= meta.total_pages}
          onClick={() => onPage(meta.page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
