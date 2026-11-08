import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  devIndicators: false,
  reactStrictMode: true,
  // Pin the workspace root so a stray package-lock.json in a parent folder is ignored.
  outputFileTracingRoot: path.resolve(__dirname),
};

export default nextConfig;
