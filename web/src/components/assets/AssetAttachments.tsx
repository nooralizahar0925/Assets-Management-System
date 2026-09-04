import { useRef, useState } from "react";
import { assetsApi } from "../../api/assets";
import { useAuth } from "../../context/AuthContext";
import { ApiError } from "../../api/client";
import type { Attachment } from "../../api/types";

const size = (bytes: string) => {
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

export default function AssetAttachments({
  assetId, attachments, onChanged,
}: { assetId: string; attachments: Attachment[]; onChanged: () => void }) {
  const { can } = useAuth();
  // Uploading and removing both change the asset's record, so both need write
  // access. A viewer sees the files and can open them, and that is all.
  const canEdit = can("assets:write");
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const kind = file.type.startsWith("image/") ? "photo" : "file";
        await assetsApi.addAttachment(assetId, file, kind);
      }
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? (err.problem.detail ?? err.message) : "Upload failed.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded-lg bg-error-50 px-3 py-2 text-sm text-error-600 dark:bg-error-500/10">
          {error}
        </p>
      )}

      {attachments.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {canEdit
            ? "No files yet. Attach condition photos, warranty documents or the manual."
            : "No files have been attached to this asset."}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="flex items-center gap-3 rounded-xl border border-gray-200 p-3 dark:border-gray-800"
            >
              {attachment.content_type.startsWith("image/") ? (
                <img
                  src={assetsApi.attachmentUrl(attachment.id)}
                  alt={attachment.filename}
                  className="h-12 w-12 rounded-lg object-cover"
                />
              ) : (
                <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-gray-100 text-theme-xs font-medium text-gray-500 dark:bg-gray-800">
                  {attachment.filename.split(".").pop()?.toUpperCase() ?? "FILE"}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <a
                  href={assetsApi.attachmentUrl(attachment.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-sm font-medium text-gray-800 hover:text-brand-500 dark:text-white/90"
                >
                  {attachment.filename}
                </a>
                <span className="text-theme-xs text-gray-400">
                  {size(attachment.size_bytes)}
                </span>
              </div>
              {canEdit && (
                <button
                  type="button"
                  onClick={async () => {
                    await assetsApi.removeAttachment(attachment.id);
                    onChanged();
                  }}
                  className="text-theme-xs text-gray-400 hover:text-error-500"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <input
          ref={inputRef}
          type="file"
          multiple
          aria-label="Attach files"
          // The same allowlist the API enforces, so the picker does not offer a
          // file the upload would then reject.
          accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/csv"
          onChange={(e) => void upload(e.target.files)}
          className="block w-full text-sm text-gray-500 file:mr-4 file:rounded-lg file:border-0 file:bg-brand-500 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-brand-600 dark:text-gray-400"
          disabled={busy}
        />
      )}
    </div>
  );
}
