import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Stop `next dev` from appending its own block to our CLAUDE.md.
  agentRules: false,
};

export default nextConfig;
