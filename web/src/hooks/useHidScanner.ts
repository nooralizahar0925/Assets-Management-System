import { useEffect, useRef } from "react";

/** A scanner types far faster than a person; 50 ms is comfortably between the two. */
const MAX_GAP_MS = 50;
const MIN_LENGTH = 3;

/**
 * Detects a hardware barcode scanner. Such a scanner presents as a keyboard: it
 * types the payload in a burst and finishes with Enter. Watching for that burst
 * anywhere on the page means staff can scan from any screen with no field focused
 * and no camera permission.
 */
export function useHidScanner(
  onScan: (value: string) => void,
  enabled = true,
): void {
  const buffer = useRef("");
  const lastKeyAt = useRef(0);
  const onScanRef = useRef(onScan);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!enabled) return;

    function handle(event: KeyboardEvent) {
      // Someone typing into a field is not scanning.
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;

      const now = Date.now();
      const gap = now - lastKeyAt.current;
      lastKeyAt.current = now;

      if (event.key === "Enter") {
        const value = buffer.current;
        buffer.current = "";
        if (value.length >= MIN_LENGTH && gap <= MAX_GAP_MS) onScanRef.current(value);
        return;
      }

      // A slow keystroke means a person: start the buffer over.
      if (gap > MAX_GAP_MS) buffer.current = "";
      if (event.key.length === 1) buffer.current += event.key;
    }

    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [enabled]);
}
