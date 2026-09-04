import { Suspense, lazy } from "react";
import { useNavigate } from "react-router";

// The barcode decoder is roughly half the application bundle and only a
// fraction of staff ever scan. Loading it when the dialog first opens keeps it
// off every other page.
const ScanModal = lazy(() => import("./ScanModal"));
import { useModal } from "../../hooks/useModal";
import { useHidScanner } from "../../hooks/useHidScanner";
import { useAuth } from "../../context/AuthContext";
import { assetsApi } from "../../api/assets";

export default function ScanButton() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const { isOpen, openModal, closeModal } = useModal();

  // A handheld scanner works from any screen, whether or not the dialog is open.
  // Closing first matters: without it a scan made with the dialog open navigates
  // underneath it and leaves the visitor looking at a stale scanner.
  useHidScanner((value) => {
    closeModal();
    void assetsApi.lookup(value)
      .then((asset) => navigate(`/assets/${asset.id}`))
      .catch(() => navigate(`/assets?q=${encodeURIComponent(value)}`));
  }, can("assets:read"));

  // Scanning only ever leads to an asset page. Offering it to someone who cannot
  // read the register gives them a button that can only ever fail.
  if (!can("assets:read")) return null;

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        title="Scan an asset (or use a handheld scanner from any screen)"
        className="flex h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-200 hover:bg-gray-100 dark:text-gray-300 dark:ring-gray-800 dark:hover:bg-white/[0.03]"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M4 7V5a1 1 0 011-1h2M4 17v2a1 1 0 001 1h2M20 7V5a1 1 0 00-1-1h-2M20 17v2a1 1 0 01-1 1h-2M4 12h16"
            stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
          />
        </svg>
        <span className="hidden sm:inline">Scan</span>
      </button>

      {isOpen && (
        <Suspense fallback={null}>
          <ScanModal
            isOpen
            onClose={closeModal}
            onResolved={(asset) => {
              closeModal();
              navigate(`/assets/${asset.id}`);
            }}
          />
        </Suspense>
      )}
    </>
  );
}
