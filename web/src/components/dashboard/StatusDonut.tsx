import Chart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";
import { STATUS_COLORS } from "../../lib/palette";
import { statusLabel } from "../assets/StatusBadge";
import type { AssetStatus } from "../../api/types";

export default function StatusDonut({
  data,
}: { data: { status: AssetStatus; count: number }[] }) {
  if (data.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
        No assets to chart yet.
      </p>
    );
  }

  const options: ApexOptions = {
    chart: { type: "donut", fontFamily: "inherit" },
    labels: data.map((d) => statusLabel(d.status)),
    colors: data.map((d) => STATUS_COLORS[d.status] ?? "#9ca3af"),
    legend: { position: "bottom", fontSize: "13px" },
    dataLabels: { enabled: false },
    stroke: { width: 2 },
    plotOptions: {
      pie: {
        donut: {
          size: "62%",
          labels: {
            show: true,
            total: {
              show: true, label: "Assets",
              formatter: () =>
                data.reduce((sum, d) => sum + d.count, 0).toLocaleString("en-GB"),
            },
          },
        },
      },
    },
  };

  return (
    <Chart options={options} series={data.map((d) => d.count)} type="donut" height={300} />
  );
}
