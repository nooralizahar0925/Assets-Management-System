import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import PageMeta from "../../components/common/PageMeta";
import PageBreadcrumb from "../../components/common/PageBreadCrumb";
import ComponentCard from "../../components/common/ComponentCard";
import StatusBadge from "../../components/assets/StatusBadge";
import HistoryTimeline from "../../components/assets/HistoryTimeline";
import AssetAttachments from "../../components/assets/AssetAttachments";
import LabelPreview from "../../components/assets/LabelPreview";
import CheckOutDialog from "../../components/assets/CheckOutDialog";
import CheckInDialog from "../../components/assets/CheckInDialog";
import { useModal } from "../../hooks/useModal";
import { assetsApi } from "../../api/assets";
import { useAuth } from "../../context/AuthContext";
import type { Asset, Assignment, AuditEvent, Attachment } from "../../api/types";

type Tab = "overview" | "history" | "files";

export default function AssetDetail() {
  const { id = "" } = useParams();
  const { can } = useAuth();
  const checkOut = useModal();
  const checkIn = useModal();

  const [asset, setAsset] = useState<Asset | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [detail, history, files] = await Promise.all([
        assetsApi.get(id), assetsApi.history(id), assetsApi.attachments(id),
      ]);
      setAsset(detail);
      setEvents(history.events);
      setAssignments(history.assignments);
      setAttachments(files);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return <p className="p-8 text-sm text-gray-500">Loading asset…</p>;
  }
  if (!asset) {
    return (
      <div className="p-8">
        <p className="text-sm text-gray-500">This asset could not be found.</p>
        <Link to="/assets" className="text-sm text-brand-500">Back to the register</Link>
      </div>
    );
  }

  const facts: [string, string][] = [
    ["Asset tag", asset.asset_tag],
    ["Serial number", asset.serial_no ?? "—"],
    ["Category", asset.category_name ?? "—"],
    ["Location", asset.location_name ?? "—"],
    ["Held by", asset.assignee_name ?? "—"],
    ["Purchased", asset.purchase_date ?? "—"],
    ["Purchase cost", asset.purchase_cost
      ? new Intl.NumberFormat("id-ID", {
          style: "currency", currency: asset.currency, maximumFractionDigits: 0,
        }).format(Number(asset.purchase_cost))
      : "—"],
  ];

  return (
    <>
      <PageMeta title={`${asset.name} | AMS`} description="Asset detail" />
      <PageBreadcrumb pageTitle={asset.name} />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <StatusBadge status={asset.status} size="md" />
        <div className="ml-auto flex flex-wrap gap-2">
          {can("custody:write") && asset.status !== "in_use" && (
            <button
              type="button" onClick={checkOut.openModal}
              className="rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600"
            >
              Check out
            </button>
          )}
          {can("custody:write") && asset.status === "in_use" && (
            <button
              type="button" onClick={checkIn.openModal}
              className="rounded-lg bg-success-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-success-600"
            >
              Check in
            </button>
          )}
          {can("assets:write") && (
            <Link
              to={`/assets/${asset.id}/edit`}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-white/[0.03]"
            >
              Edit
            </Link>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <div className="flex gap-1 border-b border-gray-200 dark:border-gray-800">
            {(["overview", "history", "files"] as Tab[]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setTab(option)}
                className={`-mb-px border-b-2 px-4 py-3 text-sm font-medium capitalize transition ${
                  tab === option
                    ? "border-brand-500 text-brand-500"
                    : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400"
                }`}
              >
                {option === "files" ? `Files (${attachments.length})` : option}
              </button>
            ))}
          </div>

          {tab === "overview" && (
            <ComponentCard title="Details">
              <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                {facts.map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-theme-xs text-gray-500 dark:text-gray-400">{label}</dt>
                    <dd className="mt-0.5 text-sm text-gray-800 dark:text-white/90">{value}</dd>
                  </div>
                ))}
              </dl>

              {Object.keys(asset.custom).length > 0 && (
                <div className="mt-6 border-t border-gray-100 pt-6 dark:border-gray-800">
                  <h4 className="mb-3 text-sm font-medium text-gray-800 dark:text-white/90">
                    {asset.category_name} fields
                  </h4>
                  <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                    {Object.entries(asset.custom).map(([key, value]) => (
                      <div key={key}>
                        <dt className="text-theme-xs text-gray-500 dark:text-gray-400">{key}</dt>
                        <dd className="mt-0.5 text-sm text-gray-800 dark:text-white/90">
                          {String(value ?? "—")}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}

              {asset.description && (
                <p className="mt-6 border-t border-gray-100 pt-6 text-sm text-gray-600 dark:border-gray-800 dark:text-gray-400">
                  {asset.description}
                </p>
              )}
            </ComponentCard>
          )}

          {tab === "history" && (
            <ComponentCard title="History" desc="Every recorded change, newest first.">
              <HistoryTimeline events={events} assignments={assignments} />
            </ComponentCard>
          )}

          {tab === "files" && (
            <ComponentCard title="Files" desc="Photos, documents and manuals.">
              <AssetAttachments
                assetId={asset.id} attachments={attachments}
                onChanged={() => void load()}
              />
            </ComponentCard>
          )}
        </div>

        <div className="space-y-5">
          <ComponentCard title="Label">
            <LabelPreview assetId={asset.id} assetTag={asset.asset_tag} />
          </ComponentCard>
        </div>
      </div>

      <CheckOutDialog
        assetId={asset.id} isOpen={checkOut.isOpen} onClose={checkOut.closeModal}
        onDone={() => { checkOut.closeModal(); void load(); }}
      />
      <CheckInDialog
        assetId={asset.id} isOpen={checkIn.isOpen} onClose={checkIn.closeModal}
        onDone={() => { checkIn.closeModal(); void load(); }}
      />
    </>
  );
}
