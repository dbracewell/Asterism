import { describe, expect, it } from "vitest";
import { PROVIDER_SERVICES } from "@/test/provider-services";
import { apiKeyRequired, providerSchemaFor } from "./provider-schema";

const catalog = PROVIDER_SERVICES;
const base = {
  id: "p1",
  name: "P",
  base_url: "http://localhost:11434/v1",
  api_key: "",
};

describe("apiKeyRequired (US-125.3)", () => {
  it("needs a key for OpenAI, hosted services and aggregators only", () => {
    expect(apiKeyRequired({ provider_type: "openai" }, catalog)).toBe(true);
    expect(
      apiKeyRequired(
        { provider_type: "generic_openai", service: "gemini" },
        catalog,
      ),
    ).toBe(true);
    expect(
      apiKeyRequired(
        { provider_type: "generic_openai", service: "openrouter" },
        catalog,
      ),
    ).toBe(true);
    expect(
      apiKeyRequired(
        { provider_type: "generic_openai", service: "ollama" },
        catalog,
      ),
    ).toBe(false);
    expect(
      apiKeyRequired(
        { provider_type: "generic_openai", service: null },
        catalog,
      ),
    ).toBe(false);
  });

  it("treats a service as needing a key until the catalog loads", () => {
    expect(
      apiKeyRequired(
        { provider_type: "generic_openai", service: "ollama" },
        undefined,
      ),
    ).toBe(true);
  });
});

describe("providerSchemaFor", () => {
  const schema = providerSchemaFor(catalog);
  it("accepts an empty key for a local server or Custom", () => {
    for (const service of ["ollama", null] as const) {
      expect(
        schema.safeParse({ ...base, provider_type: "generic_openai", service })
          .success,
      ).toBe(true);
    }
  });

  it("refuses an empty key where one is needed", () => {
    const result = schema.safeParse({
      ...base,
      base_url: "https://openrouter.ai/api/v1",
      provider_type: "generic_openai",
      service: "openrouter",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path: ["api_key"],
        message: "API key is required.",
      }),
    ]);
  });
});
