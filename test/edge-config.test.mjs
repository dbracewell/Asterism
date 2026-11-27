import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { validateConfiguration } from "../scripts/config-contract.mjs";
import {
  MULTIPART_ALLOWANCE_BYTES,
  renderEdgeConfig,
  writeEdgeConfig,
} from "../scripts/edge-config.mjs";

const issuesFor = (environment) =>
  validateConfiguration({ environment, profile: "build" }).issues.map(
    (issue) => issue.name,
  );

test("the upload limit and trusted proxies are validated settings", () => {
  assert.deepEqual(issuesFor({ MAX_UPLOAD_FILE_SIZE_BYTES: "1048576" }), []);
  for (const value of ["0", "1.5", "104857601", "ten"]) {
    assert.deepEqual(issuesFor({ MAX_UPLOAD_FILE_SIZE_BYTES: value }), [
      "MAX_UPLOAD_FILE_SIZE_BYTES",
    ]);
  }
  assert.deepEqual(
    issuesFor({ TRUSTED_PROXIES: "10.0.0.0/8, 192.0.2.7,fd00::/8" }),
    [],
  );
  assert.deepEqual(issuesFor({ TRUSTED_PROXIES: "" }), []);
  for (const value of [
    '["10.0.0.1"]',
    "10.0.0.0/33",
    "example.com",
    "10.0.0.1; deny all",
    "10.0.0.1,",
  ]) {
    assert.deepEqual(issuesFor({ TRUSTED_PROXIES: value }), [
      "TRUSTED_PROXIES",
    ]);
  }
});

test("nginx gets the request limit and a JSON refusal", () => {
  const { "server.conf": server } = renderEdgeConfig({
    MAX_UPLOAD_FILE_SIZE_BYTES: String(5 * 1024 * 1024),
  });
  assert.match(
    server,
    new RegExp(
      `^client_max_body_size ${5 * 1024 * 1024 + MULTIPART_ALLOWANCE_BYTES};$`,
      "m",
    ),
  );
  const body = /return 413 '([^']+)';/.exec(server)[1];
  assert.deepEqual(JSON.parse(body), {
    detail: "The upload is larger than the 5 MB limit.",
  });
  // The default is the backend's own maximum.
  assert.match(
    renderEdgeConfig({})["server.conf"],
    new RegExp(`client_max_body_size ${100 * 1024 * 1024 + MULTIPART_ALLOWANCE_BYTES};`),
  );
});

test("HSTS is sent only for an HTTPS public URL", () => {
  const https = renderEdgeConfig({ PUBLIC_URL: "https://asterism.example" });
  assert.match(https["hsts.conf"], /Strict-Transport-Security "max-age=31536000"/);
  assert.match(https["server.conf"], /Strict-Transport-Security/);
  const http = renderEdgeConfig({ PUBLIC_URL: "http://localhost:3000" });
  assert.equal(http["hsts.conf"], "");
  assert.doesNotMatch(http["server.conf"], /Strict-Transport-Security/);
});

test("X-Forwarded-For and the scheme are trusted only from listed proxies", () => {
  assert.equal(
    renderEdgeConfig({})["http.conf"],
    [
      "geo $realip_remote_addr $from_trusted_proxy {",
      "    default 0;",
      "}",
      "",
    ].join("\n"),
  );
  assert.equal(
    renderEdgeConfig({ TRUSTED_PROXIES: "10.0.0.0/8,::1" })["http.conf"],
    [
      "set_real_ip_from 10.0.0.0/8;",
      "set_real_ip_from ::1;",
      "real_ip_header X-Forwarded-For;",
      "real_ip_recursive on;",
      "geo $realip_remote_addr $from_trusted_proxy {",
      "    default 0;",
      "    10.0.0.0/8 1;",
      "    ::1 1;",
      "}",
      "",
    ].join("\n"),
  );
  assert.throws(
    () => renderEdgeConfig({ TRUSTED_PROXIES: "0.0.0.0/0; allow all" }),
    /TRUSTED_PROXIES/,
  );
});

test("the public server answers only PUBLIC_URL's host and loopback", () => {
  const serverName = (environment) =>
    /^server_name (.+);$/m.exec(renderEdgeConfig(environment)["server.conf"])[1];
  assert.equal(serverName({}), "localhost 127.0.0.1 [::1]");
  assert.equal(
    serverName({ PUBLIC_URL: "https://Asterism.Example:8443/app" }),
    "asterism.example localhost 127.0.0.1 [::1]",
  );
  assert.equal(
    serverName({ PUBLIC_URL: "http://[fd00::5]:3000" }),
    "[fd00::5] localhost 127.0.0.1 [::1]",
  );
});

test("nginx removes the system key from public requests and scopes long timeouts", () => {
  const nginx = readFileSync(
    new URL("../docker/nginx.conf", import.meta.url),
    "utf8",
  );
  const servers = nginx.split(/\n    server \{/).slice(1);
  const [refusal, internal, external] = servers;
  assert.match(refusal, /listen 3000 default_server;\s+return 421;/);
  assert.match(internal, /listen 127\.0\.0\.1:3000;/);
  assert.doesNotMatch(internal, /System-Key/i);
  assert.match(external, /proxy_set_header X-Asterism-System-Key "";/);
  assert.doesNotMatch(nginx, /default \$http_x_forwarded_proto/);
  // Only the stream locations get an hour and unbuffered proxying.
  const locations = external.split(/\n        location /).slice(1);
  assert.ok(locations.length >= 6);
  for (const location of locations) {
    const path = location.split(" {")[0];
    const streaming = /^(\/api\/py\/chat\/stream\/|= \/api\/stream)$/.test(path);
    assert.equal(/proxy_read_timeout 3600s/.test(location), streaming, path);
    assert.equal(/proxy_buffering off/.test(location), streaming, path);
  }
  const head = external.split(/\n        location /)[0];
  assert.doesNotMatch(head, /3600s|proxy_buffering/);
});

test("writes every snippet nginx includes, even empty ones", () => {
  const directory = mkdtempSync(join(tmpdir(), "asterism-edge-"));
  try {
    writeEdgeConfig(join(directory, "nginx"), {});
    for (const name of ["http.conf", "server.conf", "hsts.conf"]) {
      readFileSync(join(directory, "nginx", name), "utf8");
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
