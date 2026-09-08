import { useState } from "react";
import { assetsApi } from "../../api/assets";
import { useAuth } from "../../context/AuthContext";

interface Props {
  selected: Set<string>;
  onClear: () => void;
  onChanged: () => void;
}

export default function BulkActionBar({ selected, onClear, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const ids = [...selected];
  const { can } = useAuth();

  if (ids.length === 0) return null;

  async function setStatus(status: string) {
    setBusy(true);
    try {
      // Sequential rather than parallel: a bulk retire of 300 assets should not
      // open 300 connections.
      for (const id of ids) await assetsApi.update(id, { status: status as never });
      onClear();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function printLabels(symbology: "qr" | "code128") {
    setBusy(true);
    try {
      const html = await assetsApi.labelSheet({
        asset_ids: ids, symbology, template: "avery5160",
      });
      const sheet = window.open("", "_blank");
      if (sheet) {
        sheet.document.write(html);
        sheet.document.close();
      }
    } finally {
      setBusy(false);
    }
  }

  const action =
    "rounded-lg px-3 py-2 text-theme-xs font-medium text-white/90 " +
    "ring-1 ring-inset ring-white/25 hover:bg-white/10 disabled:opacity-50";

  // Each action is gated on the permission the API enforces for it, so the bar
  // never offers something the server would refuse. A viewer sees the count and
  // nothing else; a technician sees labels but not retirement.
  const canPrint = can("labels:print");
  const canWrite = can("assets:write");

  return (
    <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-2xl bg-gray-900 px-5 py-3.5 shadow-lg dark:bg-gray-800">
      <span className="text-sm font-medium text-white">
        {ids.length} selected
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {canPrint && (
          <>
            <button type="button" className={action} disabled={busy}
                    onClick={() => printLabels("qr")}>
              Print QR labels
            </button>
            <button type="button" className={action} disabled={busy}
                    onClick={() => printLabels("code128")}>
              Print barcodes
            </button>
          </>
        )}
        {canWrite && (
          <>
            <button type="button" className={action} disabled={busy}
                    onClick={() => setStatus("maintenance")}>
              Send to maintenance
            </button>
            <button type="button" className={action} disabled={busy}
                    onClick={() => setStatus("retired")}>
              Retire
            </button>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto text-theme-xs font-medium text-white/70 hover:text-white"
      >
        Clear selection
      </button>
    </div>
  );
}
