import Chart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";
import { colorFor, PALETTE } from "../../lib/palette";
import type { ReportResult } from "../../api/types";

/** Renders the server's ChartSpec, so screen and PDF show the same chart. */
export default function ReportChart({ result }: { result: ReportResult }) {
  const { chart, rows } = result;
  if (chart.type === "none" || rows.length === 0) return null;

  const categories = rows.map((row) => String(row[chart.categoryKey] ?? ""));
  const values = rows.map((row) => Number(row[chart.valueKeys[0]] ?? 0));

  if (chart.type === "donut") {
    const options: ApexOptions = {
      chart: { type: "donut", fontFamily: "inherit" },
      labels: categories,
      colors: categories.map((label, i) => colorFor(label, i)),
      legend: { position: "bottom" },
      dataLabels: { enabled: false },
      plotOptions: { pie: { donut: { size: "62%" } } },
    };
    return <Chart options={options} series={values} type="donut" height={320} />;
  }

  const horizontal = chart.type === "bar";
  const type = chart.type === "line" ? "line" : "bar";
  const options: ApexOptions = {
    chart: { type, fontFamily: "inherit", toolbar: { show: false } },
    colors: [PALETTE[0]],
    plotOptions: { bar: { horizontal, borderRadius: 4, barHeight: "60%" } },
    xaxis: { categories },
    stroke: type === "line" ? { curve: "smooth", width: 2 } : undefined,
    markers: type === "line" ? { size: 4 } : undefined,
    dataLabels: { enabled: type !== "line" },
    grid: { borderColor: "#e5e7eb", strokeDashArray: 3 },
  };

  return (
    <Chart
      options={options}
      series={[{ name: chart.valueLabel, data: values }]}
      type={type}
      height={horizontal ? Math.max(260, rows.length * 40) : 320}
    />
  );
}
