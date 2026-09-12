import { useEffect, useRef, useState, type FormEvent } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";
import { Modal } from "../ui/modal";
import Input from "../form/input/InputField";
import Label from "../form/Label";
import { assetsApi } from "../../api/assets";
import type { Asset } from "../../api/types";

/**
 * Why the camera did not start.
 *
 * Worth telling apart. "insecure" is the one that actually happens: a phone
 * opening the deployment's LAN address over http is not a secure context, so
 * getUserMedia is refused by the browser before any of this code runs - and it
 * is refused with the same exception as a denied permission. Somebody told only
 * "camera unavailable" goes hunting through phone settings for a problem that
 * is in the URL bar.
 */
type CameraProblem = "none" | "insecure" | "refused" | "missing";

const CAMERA_MESSAGE: Record<CameraProblem, string> = {
  none: "Camera unavailable. Use a handheld scanner or enter the tag below.",
  insecure:
    "This page is not served over HTTPS, so the browser will not allow the "
    + "camera. Open it over HTTPS, or use a handheld scanner or the box below.",
  refused:
    "Camera permission was refused. Allow it in your browser settings, or use "
    + "a handheld scanner or the box below.",
  missing:
    "No camera was found. Use a handheld scanner or enter the tag below.",
};

function diagnose(err: unknown): CameraProblem {
  // Checked first: an insecure page refuses with the same NotAllowedError a
  // denied permission does, so asking about the error alone gets it wrong.
  if (typeof window !== "undefined" && window.isSecureContext === false) {
    return "insecure";
  }
  const name = err instanceof Error ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "refused";
  return "missing";
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onResolved: (asset: Asset) => void;
}

export default function ScanModal({ isOpen, onClose, onResolved }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const [manual, setManual] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraProblem, setCameraProblem] = useState<CameraProblem>("none");

  async function resolve(value: string) {
    setError(null);
    try {
      const asset = await assetsApi.lookup(value);
      controlsRef.current?.stop();
      onResolved(asset);
    } catch {
      setError(`No asset is registered with the tag "${value}".`);
    }
  }

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const reader = new BrowserMultiFormatReader();

    reader.decodeFromVideoDevice(undefined, videoRef.current!, (result) => {
      if (result && !cancelled) void resolve(result.getText());
    })
      .then((controls) => {
        if (cancelled) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
        setCameraReady(true);
      })
      .catch((err: unknown) => {
        // Manual entry still works, so any of these is a downgrade rather than
        // a failure - but which one decides what the person should do next, and
        // one message for all three sends them to the wrong place.
        setCameraReady(false);
        setCameraProblem(diagnose(err));
      });

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
      setCameraReady(false);
      setCameraProblem("none");
    };
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  function onManualSubmit(event: FormEvent) {
    event.preventDefault();
    if (manual.trim()) void resolve(manual.trim());
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="max-w-md p-6">
      <h3 className="mb-1 text-lg font-medium text-gray-800 dark:text-white/90">
        Scan an asset
      </h3>
      <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
        Point the camera at a QR code or barcode, use a handheld scanner, or type the
        tag.
      </p>

      <div className="relative mb-4 aspect-video overflow-hidden rounded-xl bg-gray-900">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
        {!cameraReady && (
          <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-white/70">
            {CAMERA_MESSAGE[cameraProblem]}
          </p>
        )}
        {cameraReady && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-8 rounded-lg border-2 border-white/70"
          />
        )}
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-lg border border-error-500 bg-error-50 px-3 py-2 text-sm text-error-600 dark:bg-error-500/10">
          {error}
        </div>
      )}

      <form onSubmit={onManualSubmit} className="flex items-end gap-2">
        <div className="flex-1">
          <Label htmlFor="scan-manual">Asset tag</Label>
          <Input
            id="scan-manual" type="text" value={manual} placeholder="AMS-000123"
            onChange={(e) => setManual(e.target.value)}
          />
        </div>
        <button
          type="submit"
          className="h-11 rounded-lg bg-brand-500 px-4 text-sm font-medium text-white hover:bg-brand-600"
        >
          Find
        </button>
      </form>
    </Modal>
  );
}
