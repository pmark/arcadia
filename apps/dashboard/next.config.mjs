import { fileURLToPath } from "node:url";

const liveBuild = Boolean(process.env.ARCADIA_DASHBOARD_DIST);

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The live dashboard builds into its own folder, so it never touches a running server (scripts/dashboard-build.sh).
  // CI type-checks every commit, so that build needn't do it again.
  ...(liveBuild ? { distDir: process.env.ARCADIA_DASHBOARD_DIST, typescript: { ignoreBuildErrors: true } } : { output: "standalone" }),
  allowedDevOrigins: ["arcadia-1.alpine-rattlesnake.ts.net"],
  // `next dev` is the fallback for the live dashboard; its floating "N" indicator covers the pages on a phone.
  devIndicators: false,
  webpack(config) {
    // A live build uses the source, so it matches its commit whatever state the compiled CLI is in.
    if (liveBuild) {
      config.resolve.alias = {
        ...(config.resolve.alias ?? {}),
        "@pmark/arcadia/intelligence/client$": fileURLToPath(new URL("../../src/intelligence/client/index.ts", import.meta.url)),
        "@pmark/arcadia/intelligence/contracts$": fileURLToPath(new URL("../../src/intelligence/contracts.ts", import.meta.url))
      };
    }
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js", ".jsx"]
    };
    return config;
  }
};

export default nextConfig;
