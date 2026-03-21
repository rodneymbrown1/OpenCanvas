import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["chokidar", "ws"],
};

export default nextConfig;
