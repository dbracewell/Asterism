import { existsSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";

type SecretName = "BETTER_AUTH_SECRET" | "SYSTEM_KEY" | "ADMIN_PASSPHRASE";

const fullRuntimeProfiles = new Set(["development", "production"]);
const authProfiles = new Set([
  "development",
  "production",
  "auth-migrate",
  "reset",
]);
const profiles = new Set([
  ...authProfiles,
  "backend-init",
  "build",
  "test",
  "codegen",
]);
const placeholderPrefixes = [
  "replace-with-",
  "build-only-placeholder",
  "test-only-",
  "disposable-",
];

export type FrontendServerConfig = {
  profile: string;
  publicUrl: string;
  betterAuthSecret: string;
  systemKey: string;
  adminPassphrase: string;
  storageRoot: string;
  authDbPath: string;
};

let cachedConfig: FrontendServerConfig | undefined;

function fileSecret(name: SecretName): string | undefined {
  const directory = "/run/secrets";
  const canonical = join(directory, name);
  const entries = existsSync(directory)
    ? new Set(readdirSync(directory))
    : new Set();
  const hasCanonical = entries.has(name);
  const hasLegacy = entries.has(name.toLowerCase());
  if (hasCanonical && hasLegacy) {
    throw new Error(
      `${name}: ambiguous file secret names; keep only the uppercase file`,
    );
  }
  if (hasLegacy) {
    throw new Error(`${name}: legacy file secret name; rename it to uppercase`);
  }
  if (!hasCanonical) return undefined;
  return readFileSync(canonical, "utf8").replace(/\r?\n$/, "");
}

function secret(name: SecretName): string {
  return process.env[name] ?? fileSecret(name) ?? "";
}

function validateOrigin(value: string, production: boolean) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("PUBLIC_URL: must be an absolute browser-facing origin");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    value.endsWith("/")
  ) {
    throw new Error(
      "PUBLIC_URL: must be an http(s) origin without credentials, path, query, fragment, or trailing slash",
    );
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (production && url.protocol !== "https:" && !loopback) {
    throw new Error("PUBLIC_URL: production origins must use https");
  }
}

function validateSecret(
  name: SecretName,
  value: string,
  profile: string,
  required: boolean,
) {
  if (!required) return;
  if (!value) throw new Error(`${name}: is required (value redacted)`);
  if (placeholderPrefixes.some((prefix) => value.startsWith(prefix))) {
    throw new Error(`${name}: uses a known placeholder (value redacted)`);
  }
  if (profile === "production") {
    const minimum = name === "ADMIN_PASSPHRASE" ? 12 : 32;
    if (value.length < minimum) {
      throw new Error(
        `${name}: does not meet the production strength requirement (value redacted)`,
      );
    }
  }
}

export function getFrontendServerConfig(): FrontendServerConfig {
  if (cachedConfig) return cachedConfig;
  const profile =
    process.env.ASTERISM_CONFIG_PROFILE ??
    (process.env.NODE_ENV === "production" ? "production" : "development");
  if (!profiles.has(profile)) {
    throw new Error(`ASTERISM_CONFIG_PROFILE: unknown profile ${profile}`);
  }
  const fullRuntime = fullRuntimeProfiles.has(profile);
  const authRequired = authProfiles.has(profile);
  const publicUrl = process.env.PUBLIC_URL ?? "http://localhost:3000";
  const betterAuthSecret = secret("BETTER_AUTH_SECRET");
  const systemKey = secret("SYSTEM_KEY");
  const adminPassphrase = secret("ADMIN_PASSPHRASE");
  const storageRoot = process.env.STORAGE_ROOT ?? "/storage";
  const authDbPath =
    process.env.BETTER_AUTH_DB_PATH ?? join(storageRoot, "users.db");

  if (authRequired) {
    validateOrigin(publicUrl, profile === "production");
    validateSecret(
      "BETTER_AUTH_SECRET",
      betterAuthSecret,
      profile,
      authRequired,
    );
    validateSecret("SYSTEM_KEY", systemKey, profile, fullRuntime);
    validateSecret("ADMIN_PASSPHRASE", adminPassphrase, profile, fullRuntime);
    if (!isAbsolute(storageRoot)) {
      throw new Error("STORAGE_ROOT: must be an absolute path");
    }
    if (authDbPath === ":memory:" || !isAbsolute(authDbPath)) {
      throw new Error(
        "BETTER_AUTH_DB_PATH: must be an absolute filesystem path",
      );
    }
  }

  cachedConfig = {
    profile,
    publicUrl,
    betterAuthSecret,
    systemKey,
    adminPassphrase,
    storageRoot,
    authDbPath,
  };
  return cachedConfig;
}

export function resetFrontendServerConfigForTests() {
  cachedConfig = undefined;
}
