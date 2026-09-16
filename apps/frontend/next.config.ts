import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Preserve FastAPI's trailing-slash routes. Stripping the slash causes a
  // backend redirect to its internal origin, which drops the Bearer header.
  skipTrailingSlashRedirect: true,
  // Same-origin API and WebSocket routing during local development.
  // In Docker nginx handles this path before requests reach Next.js.
  async rewrites() {
    return [
      {
        source: "/api/py/:path*/",
        destination: "http://127.0.0.1:8000/api/py/:path*/",
      },
      {
        source: "/api/py/:path*",
        destination: "http://127.0.0.1:8000/api/py/:path*",
      },
    ];
  },
  experimental: {
    turbopackFileSystemCacheForDev: false,
  },
  devIndicators: false,
};

export default nextConfig;
