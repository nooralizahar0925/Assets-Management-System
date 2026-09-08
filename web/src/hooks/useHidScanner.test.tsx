import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useHidScanner } from "./useHidScanner";

/** Types a payload at a given inter-key delay, the way a scanner or a person would. */
function type(text: string, gapMs: number, terminate = true) {
  for (const char of text) {
    vi.advanceTimersByTime(gapMs);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: char }));
  }
  if (terminate) {
    vi.advanceTimersByTime(gapMs);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  }
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useHidScanner", () => {
  it("fires on a fast keystroke burst ending in Enter", () => {
    const onScan = vi.fn();
    renderHook(() => useHidScanner(onScan));
    type("AMS-000123", 10);
    expect(onScan).toHaveBeenCalledWith("AMS-000123");
  });

  it("ignores human typing speed", () => {
    const onScan = vi.fn();
    renderHook(() => useHidScanner(onScan));
    type("AMS-000123", 120);
    expect(onScan).not.toHaveBeenCalled();
  });

  it("ignores a burst too short to be a scan", () => {
    const onScan = vi.fn();
    renderHook(() => useHidScanner(onScan));
    type("AB", 10);
    expect(onScan).not.toHaveBeenCalled();
  });

  it("ignores a burst that never terminates", () => {
    const onScan = vi.fn();
    renderHook(() => useHidScanner(onScan));
    type("AMS-000123", 10, false);
    expect(onScan).not.toHaveBeenCalled();
  });

  it("does not hijack typing into an input", () => {
    const onScan = vi.fn();
    renderHook(() => useHidScanner(onScan));
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    for (const char of "AMS-000123") {
      vi.advanceTimersByTime(10);
      input.dispatchEvent(new KeyboardEvent("keydown", { key: char, bubbles: true }));
    }
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onScan).not.toHaveBeenCalled();
    input.remove();
  });

  it("resets between scans so two scans both fire", () => {
    const onScan = vi.fn();
    renderHook(() => useHidScanner(onScan));
    type("AMS-000123", 10);
    vi.advanceTimersByTime(500);
    type("AMS-000456", 10);
    expect(onScan).toHaveBeenNthCalledWith(1, "AMS-000123");
    expect(onScan).toHaveBeenNthCalledWith(2, "AMS-000456");
  });

  it("does nothing while disabled", () => {
    const onScan = vi.fn();
    renderHook(() => useHidScanner(onScan, false));
    type("AMS-000123", 10);
    expect(onScan).not.toHaveBeenCalled();
  });

  it("detaches its listener on unmount", () => {
    const onScan = vi.fn();
    const { unmount } = renderHook(() => useHidScanner(onScan));
    unmount();
    type("AMS-000123", 10);
    expect(onScan).not.toHaveBeenCalled();
  });
});
