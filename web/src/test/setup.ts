import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Testing Library registers its own auto-cleanup only when vitest globals are
// enabled. Globals are off here - the same choice the api package made - so the
// unmount is registered explicitly. Without it every render accumulates in the
// document and queries match elements left over from earlier tests.
afterEach(cleanup);
