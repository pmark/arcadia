/** @type {import('next').NextConfig} */
const nextConfig = {
  // The live dashboard builds into its own folder, so it never touches a running server (scripts/dashboard-build.sh).
  ...(process.env.ARCADIA_DASHBOARD_DIST ? { distDir: process.env.ARCADIA_DASHBOARD_DIST } : { output: "standalone" }),
  allowedDevOrigins: ["arcadia-1.alpine-rattlesnake.ts.net"],
  // `next dev` is the fallback for the live dashboard; its floating "N" indicator covers the pages on a phone.
  devIndicators: false,
  webpack(config) {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js", ".jsx"]
    };
    return config;
  }
};

export default nextConfig;
