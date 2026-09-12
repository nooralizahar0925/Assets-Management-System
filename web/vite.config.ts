import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";

// https://vite.dev/config/
export default defineConfig({
  server: {
    // Not Vite's default 5173: this machine runs other projects, and two dev
    // servers fighting over one port is a confusing way to find that out.
    port: 5473,
    // The browser only ever talks to this dev server, so the API is served
    // under the same origin rather than on :4400. Without this, requests go to
    // the dev server itself, which answers every unknown path with index.html -
    // so signing in "succeeded" against a page of HTML and nothing worked.
    proxy: {
      "/api": {
        target: "http://localhost:4400",
        changeOrigin: true,
        configure: (proxy) => {
          // The API refuses unsafe methods whose Origin is neither APP_BASE_URL
          // nor its own. From the browser this request is same-origin; the
          // header has to say so, or every write is rejected as cross-site.
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("origin", "http://localhost:4400");
          });
        },
      },
    },
  },
  plugins: [
    react(),
    svgr({
      svgrOptions: {
        icon: true,
        // This will transform your SVG to a React component
        exportType: "named",
        namedExport: "ReactComponent",
      },
    }),
  ],
});
