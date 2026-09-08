import { Link } from "react-router";
import {
  Table, TableBody, TableCell, TableHeader, TableRow,
} from "../ui/table";
import StatusBadge from "./StatusBadge";
import type { Asset } from "../../api/types";

interface Column {
  key: string;
  label: string;
  sortable: boolean;
  align?: "right";
}

const COLUMNS: Column[] = [
  { key: "asset_tag", label: "Tag", sortable: true },
  { key: "name", label: "Asset", sortable: true },
  { key: "category", label: "Category", sortable: false },
  { key: "status", label: "Status", sortable: true },
  { key: "location", label: "Location", sortable: false },
  { key: "assignee", label: "Held by", sortable: false },
  { key: "purchase_cost", label: "Value", sortable: false, align: "right" },
];

const money = (value: string | null, currency: string) =>
  value === null || value === ""
    ? "—"
    : new Intl.NumberFormat("id-ID", {
        style: "currency", currency, maximumFractionDigits: 0,
      }).format(Number(value));

interface Props {
  assets: Asset[];
  selected: Set<string>;
  onSelect: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
  sort: string;
  onSort: (sort: string) => void;
}

export default function AssetTable({
  assets, selected, onSelect, onSelectAll, sort, onSort,
}: Props) {
  const activeColumn = sort.replace(/^-/, "");
  const descending = sort.startsWith("-");
  const allSelected = assets.length > 0 && assets.every((a) => selected.has(a.id));

  if (assets.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="text-base font-medium text-gray-800 dark:text-white/90">
          No assets match this view
        </h3>
        <p className="mx-auto mt-2 max-w-md text-sm text-gray-500 dark:text-gray-400">
          Clear the filters, add an asset, or bring your existing register in from a
          spreadsheet.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <Link
            to="/assets/new"
            className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
          >
            Add an asset
          </Link>
          <Link
            to="/import"
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-white/[0.03]"
          >
            Import a spreadsheet
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="max-w-full overflow-x-auto">
        <Table>
          <TableHeader className="border-b border-gray-100 dark:border-gray-800">
            <TableRow>
              <TableCell isHeader className="w-10 px-5 py-3">
                <input
                  type="checkbox"
                  aria-label="Select all assets on this page"
                  checked={allSelected}
                  onChange={() => onSelectAll(assets.map((a) => a.id))}
                  className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                />
              </TableCell>
              {COLUMNS.map((column) => (
                <TableCell
                  key={column.key}
                  isHeader
                  className={`px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 ${
                    column.align === "right" ? "text-right" : "text-left"
                  }`}
                >
                  {column.sortable ? (
                    <button
                      type="button"
                      onClick={() =>
                        onSort(
                          activeColumn === column.key && !descending
                            ? `-${column.key}`
                            : column.key,
                        )
                      }
                      className="inline-flex items-center gap-1 hover:text-gray-800 dark:hover:text-white/90"
                    >
                      {column.label}
                      {activeColumn === column.key && (
                        <span aria-hidden>{descending ? "↓" : "↑"}</span>
                      )}
                    </button>
                  ) : (
                    column.label
                  )}
                </TableCell>
              ))}
            </TableRow>
          </TableHeader>

          <TableBody className="divide-y divide-gray-100 dark:divide-gray-800">
            {assets.map((asset) => (
              <TableRow key={asset.id} className="hover:bg-gray-50 dark:hover:bg-white/[0.02]">
                <TableCell className="px-5 py-4">
                  <input
                    type="checkbox"
                    aria-label={`Select ${asset.name}`}
                    checked={selected.has(asset.id)}
                    onChange={() => onSelect(asset.id)}
                    className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                  />
                </TableCell>
                <TableCell className="px-5 py-4 font-mono text-theme-xs text-gray-500 dark:text-gray-400">
                  {asset.asset_tag}
                </TableCell>
                <TableCell className="px-5 py-4">
                  <Link
                    to={`/assets/${asset.id}`}
                    className="font-medium text-gray-800 hover:text-brand-500 dark:text-white/90"
                  >
                    {asset.name}
                  </Link>
                  <div className="text-theme-xs text-gray-500 dark:text-gray-400">
                    {asset.serial_no ?? "—"}
                  </div>
                </TableCell>
                <TableCell className="px-5 py-4 text-sm text-gray-600 dark:text-gray-400">
                  {asset.category_name ?? "—"}
                </TableCell>
                <TableCell className="px-5 py-4">
                  <StatusBadge status={asset.status} />
                </TableCell>
                <TableCell className="px-5 py-4 text-sm text-gray-600 dark:text-gray-400">
                  {asset.location_name ?? "—"}
                </TableCell>
                <TableCell className="px-5 py-4 text-sm text-gray-600 dark:text-gray-400">
                  {asset.assignee_name ?? "—"}
                </TableCell>
                <TableCell className="px-5 py-4 text-right text-sm text-gray-600 dark:text-gray-400">
                  {money(asset.purchase_cost, asset.currency)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
