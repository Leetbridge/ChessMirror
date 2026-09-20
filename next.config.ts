import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Stop `next dev` from writing agent instruction files into the repo.
  agentRules: false,
};

export default nextConfig;
