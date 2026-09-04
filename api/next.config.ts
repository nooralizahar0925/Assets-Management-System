import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",

  // Packages that must not be bundled by webpack.
  //   pg              - native bindings
  //   @resvg/resvg-js - ships a platform .node binary; bundling it fails the build
  //   pdfmake         - resolves its standard fonts from disk at runtime
  //   exceljs         - large, and its stream handling breaks when bundled
  //   nodemailer      - resolves transports dynamically
  serverExternalPackages: [
    "pg",
    "@resvg/resvg-js",
    "pdfmake",
    "exceljs",
    "nodemailer",
  ],

  // The api package has its own lockfile; without this Next infers a workspace
  // root from a lockfile further up the filesystem and warns on every build.
  outputFileTracingRoot: import.meta.dirname,
};

export default config;
