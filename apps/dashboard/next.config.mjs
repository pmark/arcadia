/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  allowedDevOrigins: ["arcadia-1.alpine-rattlesnake.ts.net"],
  // The live dashboard runs under `next dev`; its floating "N" indicator covers the pages on a phone.
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
