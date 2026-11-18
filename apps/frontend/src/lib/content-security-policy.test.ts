import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import {
  renderEdgeConfig,
  uploadRequestLimitBytes,
} from "../../../../scripts/edge-config.mjs";
import {
  CANVAS_PREVIEW_CSP,
  CANVAS_PREVIEW_PATH,
  PREVIEW_DOCUMENT_CSP,
  pageContentSecurityPolicy,
} from "./content-security-policy";

function directives(policy: string) {
  return new Map(
    policy.split("; ").map((directive) => {
      const [name, ...sources] = directive.split(" ");
      return [name, sources] as const;
    }),
  );
}

describe("pageContentSecurityPolicy", () => {
  const policy = (publicUrl: string, development = false) =>
    directives(
      pageContentSecurityPolicy({ nonce: "abc=", publicUrl, development }),
    );

  it("runs only nonce'd scripts and loads nothing from other origins", () => {
    const page = policy("https://asterism.example");
    expect(page.get("script-src")).toEqual([
      "'self'",
      "'nonce-abc='",
      "'strict-dynamic'",
    ]);
    expect(page.get("connect-src")).toEqual([
      "'self'",
      "wss://asterism.example",
    ]);
    expect(page.get("worker-src")).toEqual(["'self'"]);
    expect(page.get("frame-src")).toEqual(["'self'"]);
    expect(page.get("object-src")).toEqual(["'none'"]);
    expect(page.get("frame-ancestors")).toEqual(["'none'"]);
    expect(page.has("upgrade-insecure-requests")).toBe(true);
    for (const sources of page.values()) {
      expect(sources.join(" ")).not.toMatch(/https?:|\*|'unsafe-eval'/);
    }
    expect(page.get("script-src")).not.toContain("'unsafe-inline'");
  });

  it("uses ws: for HTTP origins and allows eval only in development", () => {
    const local = policy("http://localhost:3000", true);
    expect(local.get("connect-src")).toEqual(["'self'", "ws://localhost:3000"]);
    expect(local.get("script-src")).toContain("'unsafe-eval'");
    expect(local.has("upgrade-insecure-requests")).toBe(false);
  });
});

describe("canvas preview frame", () => {
  it("lets the page run inline scripts but reach no network", () => {
    const frame = directives(CANVAS_PREVIEW_CSP);
    expect(frame.get("default-src")).toEqual(["'none'"]);
    expect(frame.get("script-src")).toEqual(["'unsafe-inline'"]);
    expect(frame.has("connect-src")).toBe(false);
    expect(frame.get("frame-ancestors")).toEqual(["'self'"]);
    expect(CANVAS_PREVIEW_CSP.startsWith(PREVIEW_DOCUMENT_CSP)).toBe(true);
  });

  it("gets its policy and the shared headers from Next.js", async () => {
    const rules = await nextConfig.headers!();
    const preview = rules.find((rule) => rule.source === CANVAS_PREVIEW_PATH);
    expect(preview?.headers).toEqual([
      { key: "Content-Security-Policy", value: CANVAS_PREVIEW_CSP },
    ]);
    const shared = rules.find((rule) => rule.source === "/:path*");
    expect(shared?.headers).toEqual(
      expect.arrayContaining([
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "same-origin" },
      ]),
    );
  });
});

describe("one upload limit", () => {
  it("gives nginx and the Next.js proxy the same request limit", () => {
    for (const MAX_UPLOAD_FILE_SIZE_BYTES of [undefined, "1048576"]) {
      const environment = { MAX_UPLOAD_FILE_SIZE_BYTES };
      const limit = uploadRequestLimitBytes(environment);
      expect(renderEdgeConfig(environment)["server.conf"]).toContain(
        `client_max_body_size ${limit};`,
      );
    }
    expect(nextConfig.experimental?.proxyClientMaxBodySize).toBe(
      uploadRequestLimitBytes(process.env),
    );
  });
});
