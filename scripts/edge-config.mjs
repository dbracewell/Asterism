#!/usr/bin/env node
// Renders the deployment-specific nginx snippets (US-86.5). The static policy
// lives in docker/nginx.conf; only values that come from settings are rendered
// here, so one MAX_UPLOAD_FILE_SIZE_BYTES drives nginx, Next.js and the backend.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  CATALOG,
  MAX_UPLOAD_BYTES_LIMIT,
  parseProxyList,
} from "./config-contract.mjs";

/** Room for multipart boundaries and part headers around the file bytes. */
export const MULTIPART_ALLOWANCE_BYTES = 1024 * 1024;

/** One year. Subdomains and preload are left to the operator's own proxy. */
export const HSTS_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export function uploadLimitBytes(environment) {
  const raw =
    environment.MAX_UPLOAD_FILE_SIZE_BYTES ??
    CATALOG.MAX_UPLOAD_FILE_SIZE_BYTES.defaultValue;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_UPLOAD_BYTES_LIMIT) {
    throw new Error(
      `MAX_UPLOAD_FILE_SIZE_BYTES must be an integer from 1 to ${MAX_UPLOAD_BYTES_LIMIT}`,
    );
  }
  return value;
}

/** The largest request body nginx and the Next.js proxy accept. */
export function uploadRequestLimitBytes(environment) {
  return uploadLimitBytes(environment) + MULTIPART_ALLOWANCE_BYTES;
}

export function trustedProxies(environment) {
  const proxies = parseProxyList(environment.TRUSTED_PROXIES);
  if (proxies === undefined) {
    throw new Error(
      "TRUSTED_PROXIES must be comma-separated IP addresses or CIDR networks",
    );
  }
  return proxies;
}

function publicUrl(environment) {
  return new URL(environment.PUBLIC_URL ?? CATALOG.PUBLIC_URL.defaultValue);
}

export function isHttps(environment) {
  return publicUrl(environment).protocol === "https:";
}

/** Names the container itself uses (health checks), always accepted. */
export const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

/** Host names the public server answers; nginx refuses every other Host. */
export function servedHosts(environment) {
  const host = publicUrl(environment).hostname.toLowerCase();
  if (!/^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)$/.test(host)) {
    throw new Error("PUBLIC_URL must name a host nginx can match");
  }
  return [...new Set([host, ...LOOPBACK_HOSTS])];
}

function megabytes(bytes) {
  return Number((bytes / (1024 * 1024)).toFixed(1));
}

/** File name to contents for the snippets docker/nginx.conf includes. */
export function renderEdgeConfig(environment) {
  const limit = uploadLimitBytes(environment);
  const proxies = trustedProxies(environment);
  const hsts = isHttps(environment)
    ? `add_header Strict-Transport-Security "max-age=${HSTS_MAX_AGE_SECONDS}" always;\n`
    : "";
  // The real client address, for rate limits and logs, comes from
  // X-Forwarded-For only when the connecting peer is a listed proxy.
  const realIp = proxies.length
    ? [
        ...proxies.map((proxy) => `set_real_ip_from ${proxy};`),
        "real_ip_header X-Forwarded-For;",
        "real_ip_recursive on;",
      ]
    : [];
  // The connecting peer, before X-Forwarded-For is applied, decides whether
  // the forwarded scheme is believed.
  const trusted = [
    "geo $realip_remote_addr $from_trusted_proxy {",
    "    default 0;",
    ...proxies.map((proxy) => `    ${proxy} 1;`),
    "}",
  ];
  const tooLarge = JSON.stringify({
    detail: `The upload is larger than the ${megabytes(limit)} MB limit.`,
  });
  return {
    "http.conf": [...realIp, ...trusted, ""].join("\n"),
    "server.conf": [
      `server_name ${servedHosts(environment).join(" ")};`,
      `client_max_body_size ${uploadRequestLimitBytes(environment)};`,
      hsts.trimEnd(),
      "location @upload_too_large {",
      "    include /app/docker/nginx-api-headers.conf;",
      "    default_type application/json;",
      `    return 413 '${tooLarge}';`,
      "}",
      "",
    ]
      .filter((line) => line !== "")
      .join("\n")
      .concat("\n"),
    "hsts.conf": hsts,
  };
}

export function writeEdgeConfig(directory, environment) {
  mkdirSync(directory, { recursive: true });
  for (const [name, content] of Object.entries(
    renderEdgeConfig(environment),
  )) {
    writeFileSync(join(directory, name), content);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const directory = process.argv[2];
  if (!directory) {
    console.error("Usage: node scripts/edge-config.mjs <output directory>");
    process.exit(2);
  }
  try {
    writeEdgeConfig(directory, process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}
