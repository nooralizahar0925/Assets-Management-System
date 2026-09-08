import {
  Table, TableBody, TableCell, TableHeader, TableRow,
} from "../ui/table";
import type { ReportColumn, ReportResult } from "../../api/types";
import { formatDate } from "../../lib/datetime";

const NUMERIC = new Set(["number", "money", "percent"]);

export function formatCell(column: ReportColumn, raw: unknown): string {
  if (raw === null || raw === undefined || raw === "") return "—";
  switch (column.type) {
    case "money":
      return new Intl.NumberFormat("id-ID", {
        style: "currency", currency: "IDR", maximumFractionDigits: 0,
      }).format(Number(raw));
    case "number":
      return Number(raw).toLocaleString("en-GB");
    case "percent":
      return `${Number(raw).toFixed(1)}%`;
    case "date":
      return formatDate(String(raw));
    default:
      return String(raw);
  }
}

export default function ReportTable({ result }: { result: ReportResult }) {
  if (result.rows.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">
        No rows matched this report's filters.
      </p>
    );
  }

  return (
    <div className="max-w-full overflow-x-auto">
      <Table>
        <TableHeader className="border-b border-gray-100 dark:border-gray-800">
          <TableRow>
            {result.columns.map((column) => (
              <TableCell
                key={column.key}
                isHeader
                className={`px-5 py-3 text-theme-xs font-medium text-gray-500 dark:text-gray-400 ${
                  NUMERIC.has(column.type) ? "text-right" : "text-left"
                }`}
              >
                {column.label}
              </TableCell>
            ))}
          </TableRow>
        </TableHeader>

        <TableBody className="divide-y divide-gray-100 dark:divide-gray-800">
          {result.rows.map((row, index) => (
            <TableRow key={index}>
              {result.columns.map((column) => (
                <TableCell
                  key={column.key}
                  className={`px-5 py-3 text-sm text-gray-700 dark:text-gray-300 ${
                    NUMERIC.has(column.type) ? "text-right" : "text-left"
                  }`}
                >
                  {formatCell(column, row[column.key])}
                </TableCell>
              ))}
            </TableRow>
          ))}

          {result.totals && (
            <TableRow className="border-t-2 border-gray-200 font-medium dark:border-gray-700">
              {result.columns.map((column) => (
                <TableCell
                  key={column.key}
                  className={`px-5 py-3 text-sm text-gray-800 dark:text-white/90 ${
                    NUMERIC.has(column.type) ? "text-right" : "text-left"
                  }`}
                >
                  {formatCell(column, result.totals![column.key])}
                </TableCell>
              ))}
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
