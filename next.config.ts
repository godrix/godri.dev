import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/cataratas", destination: "/cataratas/index.html" },
      { source: "/cataratas/", destination: "/cataratas/index.html" },
      { source: "/cataratas-demo", destination: "/cataratas-demo/index.html" },
      { source: "/cataratas-demo/", destination: "/cataratas-demo/index.html" },
    ];
  },
};

export default nextConfig;
