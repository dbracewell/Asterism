import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Playwright may run while the normal development server is active. Keep
  // its compiler output and lock separate from the developer's `.next` tree.
  distDir:
    process.env.ASTERISM_CONFIG_PROFILE === "test" ? ".next-e2e" : ".next",
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
    // The rewrite proxy above defaults to a 30-second timeout. Study generation
    // (card drafts, quizzes, summaries, short-answer grading) may run up to 150
    // seconds by design, so allow longer. Docker's nginx already allows 3600s.
    proxyTimeout: 180_000,
    // middlewareClientMaxBodySize: "500mb",
    proxyClientMaxBodySize: "500mb",
  },
  devIndicators: false,
};

export default nextConfig;
