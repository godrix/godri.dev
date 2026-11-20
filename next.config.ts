import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/cataratas", destination: "/cataratas/index.html" },
      { source: "/cataratas/", destination: "/cataratas/index.html" },
    ];
  },
};

export default nextConfig;
