import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // NEXT_DIST_DIR lets parallel local builds (e.g. several agents) avoid sharing .next/.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};

export default nextConfig;
