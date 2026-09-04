import { useState } from "react";
import { assetsApi } from "../../api/assets";

export default function LabelPreview({
  assetId, assetTag,
}: { assetId: string; assetTag: string }) {
  const [symbology, setSymbology] = useState<"qr" | "code128">("qr");

  async function print() {
    const html = await assetsApi.labelSheet({
      asset_ids: [assetId], symbology, template: "thermal50x25",
    });
    const sheet = window.open("", "_blank");
    if (sheet) {
      sheet.document.write(html);
      sheet.document.close();
    }
  }

  return (
    <div className="space-y-4 text-center">
      <img
        src={assetsApi.labelUrl(assetId, symbology, 4)}
        alt={`${symbology === "qr" ? "QR code" : "Barcode"} for ${assetTag}`}
        className="mx-auto max-h-40 bg-white p-2"
      />
      <p className="font-mono text-theme-xs text-gray-500 dark:text-gray-400">{assetTag}</p>

      <div className="flex items-center justify-center gap-2">
        {(["qr", "code128"] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={symbology === option}
            onClick={() => setSymbology(option)}
            className={`rounded-full px-3 py-1 text-theme-xs font-medium ${
              symbology === option
                ? "bg-brand-500 text-white"
                : "bg-gray-100 text-gray-600 dark:bg-white/[0.05] dark:text-gray-300"
            }`}
          >
            {option === "qr" ? "QR" : "Barcode"}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => void print()}
        className="w-full rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-white/[0.03]"
      >
        Print label
      </button>
    </div>
  );
}
