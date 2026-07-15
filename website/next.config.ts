import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
  // This package is a member of the SkySend pnpm workspace (root one level up),
  // not a standalone project - point Turbopack at the actual monorepo root so
  // it can resolve dependencies hoisted into the shared pnpm virtual store.
  turbopack: {
    root: path.join(__dirname, ".."),
  },
};

export default nextConfig;
