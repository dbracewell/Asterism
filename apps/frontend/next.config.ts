import type { NextConfig } from "next";
import { uploadRequestLimitBytes } from "../../scripts/edge-config.mjs";
import {
  CANVAS_PREVIEW_CSP,
  CANVAS_PREVIEW_PATH,
  STATIC_SECURITY_HEADERS,
} from "./src/lib/content-security-policy";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Playwright may run while the normal development server is active. Keep
  // its compiler output and lock separate from the developer's `.next` tree.
  distDir:
    process.env.ASTERISM_CONFIG_PROFILE === "test" ? ".next-e2e" : ".next",
  // Preserve FastAPI's trailing-slash routes. Stripping the slash causes a
  // backend redirect to its internal origin, which drops the Bearer header.
  skipTrailingSlashRedirect: true,
  // US-86.5: the page CSP carries a per-request nonce, so src/proxy.ts sets it.
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: STATIC_SECURITY_HEADERS },
      {
        source: CANVAS_PREVIEW_PATH,
        headers: [
          { key: "Content-Security-Policy", value: CANVAS_PREVIEW_CSP },
        ],
      },
    ];
  },
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
    // The same request limit as nginx: MAX_UPLOAD_FILE_SIZE_BYTES plus room
    // for the multipart framing (US-86.5). The backend checks the files.
    proxyClientMaxBodySize: uploadRequestLimitBytes(process.env),
  },
  devIndicators: false,
};

export default nextConfig;
