import Database from "better-sqlite3";
import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { getFrontendServerConfig } from "@/lib/server-config-core";

type Check = { name: string; ok: boolean; detail: string };

/** The auth database takes a write lock (and rolls it back at once). */
function checkAuthDatabase(): Check {
  try {
    const database = new Database(getFrontendServerConfig().authDbPath, {
      fileMustExist: true,
      timeout: 2000,
    });
    try {
      database.exec("BEGIN IMMEDIATE; ROLLBACK;");
    } finally {
      database.close();
    }
    return { name: "auth_database", ok: true, detail: "" };
  } catch {
    return {
      name: "auth_database",
      ok: false,
      detail: "The auth database is not writable",
    };
  }
}

/** Signing a throwaway token proves the private key decrypts with BETTER_AUTH_SECRET. */
async function checkSigningKey(): Promise<Check> {
  try {
    const { token } = await getAuth().api.signJWT({
      body: { payload: { sub: "readiness-check", aud: "readiness-check" } },
    });
    if (!token) throw new Error("no token");
    return { name: "auth_signing_key", ok: true, detail: "" };
  } catch {
    return {
      name: "auth_signing_key",
      ok: false,
      detail: "The auth signing key could not be used",
    };
  }
}

type Readiness = { ready: boolean; checks: Check[] };

/** Readiness is public: callers within this window share one result (US-115.1). */
const READINESS_TTL_MS = 5000;
let cached: { at: number; result: Readiness } | undefined;
let checking: Promise<Readiness> | undefined;

async function runChecks(): Promise<Readiness> {
  const checks = [checkAuthDatabase(), await checkSigningKey()];
  const result = { ready: checks.every((check) => check.ok), checks };
  cached = { at: Date.now(), result };
  return result;
}

function readiness(): Promise<Readiness> {
  if (cached && Date.now() - cached.at < READINESS_TTL_MS) {
    return Promise.resolve(cached.result);
  }
  checking ??= runChecks().finally(() => {
    checking = undefined;
  });
  return checking;
}

/**
 * Frontend readiness (US-86.6): public, pass/fail only. The backend's
 * `/api/py/health/ready` checks its own database, storage and the keys it loads.
 */
export async function GET() {
  const { ready, checks } = await readiness();
  return NextResponse.json(
    { ready, checks },
    {
      status: ready ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export const dynamic = "force-dynamic";
