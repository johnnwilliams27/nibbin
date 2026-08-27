import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const here = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  // Workspace packages ship TS source; Next compiles them in place.
  transpilePackages: ["@trust-index/types"],
  // Monorepo: trace files from the trust-index root, not the host repo above it.
  outputFileTracingRoot: path.join(here, "..", ".."),
  webpack: (config) => {
    // @trust-index/types uses NodeNext-style ".js" specifiers for TS sources.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
