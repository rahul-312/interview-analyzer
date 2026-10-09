import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin the workspace root to this folder (there's another lockfile higher up).
  outputFileTracingRoot: path.join(__dirname),
  turbopack: {
    root: path.join(__dirname),
  },
  async redirects() {
    return [{ source: "/", destination: "/applications", permanent: false }];
  },
};

export default nextConfig;
