import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["chokidar", "ws"],
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  devIndicators: false,
};

export default nextConfig;
