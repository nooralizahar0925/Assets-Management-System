import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup, configure } from "@testing-library/react";

/**
 * Five seconds for findBy and waitFor, not one.
 *
 * Nothing here is slow on purpose. But several tests render the whole
 * application, whose routes are lazy, and a Suspense boundary that resolves in
 * 40ms on an idle machine can take well over a second when the other fifty-odd
 * test files are competing for the same cores. The result was a suite that
 * passed three runs in five and failed a different test each time - which
 * teaches everybody to re-run it rather than read it, and that is how a real
 * failure gets waved through.
 *
 * This costs nothing when an element is genuinely there, and delays a genuine
 * failure by four seconds. That is the right trade.
 */
configure({ asyncUtilTimeout: 5_000 });

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
