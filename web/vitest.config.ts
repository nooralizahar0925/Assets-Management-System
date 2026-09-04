import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";

export default defineConfig({
  plugins: [
    react(),
    // The icon set is SVG imported as components via `?react`. Without svgr
    // here every icon resolves to undefined, and any component rendering one
    // fails with "Element type is invalid" - which points at the component
    // rather than at the missing plugin. Kept identical to vite.config.ts.
    svgr({
      svgrOptions: {
        icon: true,
        exportType: "named",
        namedExport: "ReactComponent",
      },
    }),
  ],
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
