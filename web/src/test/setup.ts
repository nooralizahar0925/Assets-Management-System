import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Testing Library registers its own auto-cleanup only when vitest globals are
// enabled. Globals are off here - the same choice the api package made - so the
// unmount is registered explicitly. Without it every render accumulates in the
// document and queries match elements left over from earlier tests.
afterEach(cleanup);

/**
 * A working localStorage.
 *
 * This jsdom does not provide one whose methods are callable, and the only
 * component that had noticed wraps every access in try/catch - so the gap was
 * invisible until a component that reads it honestly was rendered in a test.
 */
if (typeof localStorage === "undefined" || typeof localStorage.getItem !== "function") {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() { return store.size; },
    },
  });
}
