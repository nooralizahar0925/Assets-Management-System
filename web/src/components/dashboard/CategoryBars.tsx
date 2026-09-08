import Chart from "react-apexcharts";
import type { ApexOptions } from "apexcharts";
import { PALETTE } from "../../lib/palette";

export default function CategoryBars({
  data,
}: { data: { category: string; count: number }[] }) {
  if (data.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-gray-500 dark:text-gray-400">
        No categories yet.
      </p>
    );
  }

  const options: ApexOptions = {
    chart: { type: "bar", fontFamily: "inherit", toolbar: { show: false } },
    plotOptions: { bar: { horizontal: true, borderRadius: 4, barHeight: "60%" } },
    colors: [PALETTE[0]],
    xaxis: { categories: data.map((d) => d.category) },
    dataLabels: { enabled: true },
    grid: { borderColor: "#e5e7eb", strokeDashArray: 3 },
  };

  return (
    <Chart
      options={options}
      series={[{ name: "Assets", data: data.map((d) => d.count) }]}
      type="bar"
      height={Math.max(220, data.length * 42)}
    />
  );
}
