import { accessSync, constants, existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, parse, resolve } from "node:path";

export const SECRET_NAMES = new Set([
  "BETTER_AUTH_SECRET",
  "SYSTEM_KEY",
  "ADMIN_PASSPHRASE",
]);

export const CATALOG = {
  PUBLIC_URL: {
    classification: "public",
    defaultValue: "http://localhost:3000",
  },
  BETTER_AUTH_SECRET: { classification: "secret" },
  SYSTEM_KEY: { classification: "secret" },
  ADMIN_PASSPHRASE: { classification: "secret" },
  STORAGE_ROOT: { classification: "sensitive-path", defaultValue: "/storage" },
  BETTER_AUTH_DB_PATH: { classification: "sensitive-path" },
  DB_URL: { classification: "sensitive-url" },
  PORT: { classification: "public", defaultValue: "3000" },
  MAX_CHARS_FOR_RETRIEVAL: { classification: "tuning", defaultValue: "50000" },
  CORS_ALLOWED_ORIGINS: { classification: "security-policy" },
  DEFAULT_ALLOWED_TOOLS: { classification: "capability-policy" },
};

const RUNTIME_PROFILES = new Set([
  "development",
  "production",
  "auth-migrate",
  "backend-init",
  "reset",
]);
const PROFILES = new Set([...RUNTIME_PROFILES, "build", "test", "codegen"]);
const SCOPES = new Set(["all", "frontend", "backend"]);
const PLACEHOLDER_PREFIXES = [
  "replace-with-",
  "build-only-placeholder",
  "test-only-",
  "disposable-",
];

export class ConfigurationError extends Error {
  constructor(issues) {
    super(issues.map((issue) => `${issue.name}: ${issue.message}`).join("\n"));
    this.issues = issues;
  }
}

function selectedValue(name, environment, sources) {
  if (Object.hasOwn(environment, name)) {
    return { value: environment[name], source: sources.get(name) ?? "process" };
  }
  const setting = CATALOG[name];
  if (Object.hasOwn(setting, "defaultValue")) {
    return { value: setting.defaultValue, source: "default" };
  }
  return { value: undefined, source: "missing" };
}

function requiredNames(profile, scope) {
  const required = new Set();
  if (profile === "development" || profile === "production") {
    required.add("PUBLIC_URL");
    if (scope === "all" || scope === "frontend") {
      required.add("BETTER_AUTH_SECRET");
      required.add("SYSTEM_KEY");
      required.add("ADMIN_PASSPHRASE");
    }
    if (scope === "all" || scope === "backend") {
      required.add("SYSTEM_KEY");
      required.add("STORAGE_ROOT");
    }
    if (scope === "frontend") required.add("AUTH_STORAGE");
  } else if (profile === "auth-migrate") {
    required.add("PUBLIC_URL");
    required.add("BETTER_AUTH_SECRET");
    required.add("AUTH_STORAGE");
  } else if (profile === "backend-init") {
    required.add("STORAGE_ROOT");
    required.add("BACKEND_STORAGE");
  } else if (profile === "reset") {
    if (scope === "all" || scope === "frontend") {
      required.add("PUBLIC_URL");
      required.add("BETTER_AUTH_SECRET");
      required.add("AUTH_STORAGE");
    }
    if (scope === "all" || scope === "backend") {
      required.add("STORAGE_ROOT");
      required.add("BACKEND_STORAGE");
    }
  }
  return required;
}

function validateOrigin(value, production) {
  try {
    const url = new URL(value);
    if (!new Set(["http:", "https:"]).has(url.protocol))
      return "must use http or https";
    if (url.username || url.password || url.search || url.hash) {
      return "must be an origin without credentials, query, or fragment";
    }
    if (url.pathname !== "/" || value.endsWith("/")) {
      return "must not include a path or trailing slash";
    }
    const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]).has(
      url.hostname,
    );
    if (production && url.protocol !== "https:" && !loopback) {
      return "must use https outside loopback production deployments";
    }
  } catch {
    return "must be an absolute browser-facing origin";
  }
}

function validateSecret(name, value, profile) {
  if (!value) return "is required and cannot be empty (value redacted)";
  if (PLACEHOLDER_PREFIXES.some((prefix) => value.startsWith(prefix))) {
    return "uses a known placeholder (value redacted)";
  }
  if (profile === "production") {
    const minimum = name === "ADMIN_PASSPHRASE" ? 12 : 32;
    if (value.length < minimum)
      return "does not meet the production strength requirement (value redacted)";
  }
}

function nearestExistingParent(path) {
  let candidate = resolve(path);
  const root = parse(candidate).root;
  while (!existsSync(candidate) && candidate !== root)
    candidate = dirname(candidate);
  return candidate;
}

function validateDirectoryPath(value) {
  if (!isAbsolute(value)) return "must be an absolute path";
  try {
    if (existsSync(value) && !statSync(value).isDirectory())
      return "must identify a directory";
    accessSync(nearestExistingParent(value), constants.W_OK);
  } catch {
    return "must have a writable existing parent";
  }
}

function validateFilePath(value, profile) {
  if (value === ":memory:") {
    return new Set(["build", "test"]).has(profile)
      ? undefined
      : ":memory: is allowed only for build and test";
  }
  if (!isAbsolute(value)) return "must be an absolute filesystem path";
  try {
    if (existsSync(value) && statSync(value).isDirectory())
      return "must identify a file, not a directory";
    accessSync(nearestExistingParent(dirname(value)), constants.W_OK);
  } catch {
    return "must have a writable existing parent";
  }
}

function validateDbUrl(value, profile) {
  if (!value) return;
  if (!value.startsWith("sqlite+aiosqlite:///")) {
    return "uses an unsupported database adapter (URL redacted)";
  }
  const path = value.slice("sqlite+aiosqlite:///".length);
  if (!path.startsWith("/"))
    return "SQLite database path must be absolute (URL redacted)";
  return validateFilePath(path, profile);
}

function validateJsonList(name, value) {
  if (!value) return;
  try {
    const parsed = JSON.parse(value);
    if (
      !Array.isArray(parsed) ||
      parsed.some((item) => typeof item !== "string" || !item)
    ) {
      return "must be a JSON array of non-empty strings";
    }
    if (
      name === "DEFAULT_ALLOWED_TOOLS" &&
      new Set(parsed).size !== parsed.length
    ) {
      return "must not contain duplicate tool names";
    }
    if (name === "CORS_ALLOWED_ORIGINS") {
      for (const origin of parsed) {
        if (origin === "*" || validateOrigin(origin, false)) {
          return "must contain explicit absolute origins and cannot use a wildcard";
        }
      }
    }
  } catch {
    return "must be valid JSON containing an array of strings";
  }
}

export function validateConfiguration({
  environment = process.env,
  sources = new Map(),
  profile = "development",
  scope = "all",
} = {}) {
  if (!PROFILES.has(profile))
    throw new ConfigurationError([
      { name: "PROFILE", message: `unknown profile ${profile}` },
    ]);
  if (!SCOPES.has(scope))
    throw new ConfigurationError([
      { name: "SCOPE", message: `unknown scope ${scope}` },
    ]);

  const required = requiredNames(profile, scope);
  const records = [];
  const issues = [];
  const values = new Map();
  for (const [name, details] of Object.entries(CATALOG)) {
    const selected = selectedValue(name, environment, sources);
    values.set(name, selected.value);
    let message;
    const isRequired = required.has(name);
    if (isRequired && (selected.value === undefined || selected.value === "")) {
      message = "is required and cannot be empty";
    } else if (
      SECRET_NAMES.has(name) &&
      isRequired &&
      selected.value !== undefined &&
      RUNTIME_PROFILES.has(profile)
    ) {
      message = validateSecret(name, selected.value, profile);
    } else if (
      name === "PUBLIC_URL" &&
      selected.value !== undefined &&
      RUNTIME_PROFILES.has(profile)
    ) {
      message = validateOrigin(selected.value, profile === "production");
    } else if (
      name === "STORAGE_ROOT" &&
      selected.value !== undefined &&
      required.has("STORAGE_ROOT")
    ) {
      message = validateDirectoryPath(selected.value);
      if (profile === "development" && selected.source === "default") {
        message = "must be set explicitly for local development";
      }
    } else if (name === "BETTER_AUTH_DB_PATH" && selected.value !== undefined) {
      message = validateFilePath(selected.value, profile);
    } else if (name === "DB_URL" && selected.value !== undefined) {
      message = validateDbUrl(selected.value, profile);
    } else if (name === "PORT" && selected.value !== undefined) {
      const port = Number(selected.value);
      if (!Number.isInteger(port) || port < 1 || port > 65535)
        message = "must be an integer from 1 to 65535";
    } else if (
      name === "MAX_CHARS_FOR_RETRIEVAL" &&
      selected.value !== undefined
    ) {
      const size = Number(selected.value);
      if (!Number.isInteger(size) || size < 1 || size > 1_000_000)
        message = "must be an integer from 1 to 1000000";
    } else if (
      name === "CORS_ALLOWED_ORIGINS" ||
      name === "DEFAULT_ALLOWED_TOOLS"
    ) {
      message = validateJsonList(name, selected.value);
    }
    const record = {
      name,
      classification: details.classification,
      source: selected.source,
      status: message ? "invalid" : isRequired ? "valid" : "optional",
      message,
    };
    records.push(record);
    if (message) issues.push({ name, message });
  }

  const authPath = values.get("BETTER_AUTH_DB_PATH");
  const storageRoot = values.get("STORAGE_ROOT");
  if (required.has("AUTH_STORAGE")) {
    let message = authPath
      ? validateFilePath(authPath, profile)
      : storageRoot
        ? validateDirectoryPath(storageRoot)
        : "requires BETTER_AUTH_DB_PATH or STORAGE_ROOT";
    if (
      !message &&
      !authPath &&
      profile === "development" &&
      selectedValue("STORAGE_ROOT", environment, sources).source === "default"
    ) {
      message =
        "requires an explicit local STORAGE_ROOT or BETTER_AUTH_DB_PATH";
    }
    if (message) issues.push({ name: "AUTH_STORAGE", message });
  }
  if (required.has("BACKEND_STORAGE")) {
    const message = values.get("DB_URL")
      ? validateDbUrl(values.get("DB_URL"), profile)
      : storageRoot
        ? validateDirectoryPath(storageRoot)
        : "requires DB_URL or STORAGE_ROOT";
    if (message) issues.push({ name: "BACKEND_STORAGE", message });
  }

  return { valid: issues.length === 0, records, issues };
}

export function assertValidConfiguration(options) {
  const result = validateConfiguration(options);
  if (!result.valid) throw new ConfigurationError(result.issues);
  return result;
}
