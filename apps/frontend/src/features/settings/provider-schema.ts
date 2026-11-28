import type { ProviderServiceInfo, ProviderType } from "@/lib/client";
import { zProviderService, zProviderType } from "@/lib/client/zod.gen";
import { z } from "zod";

export const OPENAI_BASE_URL = "https://api.openai.com/v1";

const providerFields = z.object({
  id: z.string(),
  name: z.string().trim().min(1, "Provider name is required."),
  base_url: z.url("Base URL must be an absolute HTTP(S) URL."),
  // Required or not depends on the service; see ``providerSchemaFor``.
  api_key: z.string().trim(),
  provider_type: zProviderType,
  // The OpenAI-compatible service it was set up from; null is Custom (ADR-0086).
  service: zProviderService.nullish(),
});

export type ProviderFormValues = z.infer<typeof providerFields>;

/**
 * Whether a provider needs an API key (US-125.3): OpenAI, hosted services and
 * aggregators do; local servers and Custom don't. A service the catalog hasn't
 * loaded yet counts as needing one.
 */
export function apiKeyRequired(
  provider: {
    provider_type: ProviderType;
    service?: ProviderServiceInfo["service"] | null;
  },
  catalog: readonly ProviderServiceInfo[] | undefined,
): boolean {
  if (provider.provider_type === "openai") return true;
  if (provider.service == null) return false;
  const entry = catalog?.find((item) => item.service === provider.service);
  return entry?.key_required ?? true;
}

/**
 * One provider's connection fields, shared by Admin settings → Providers and
 * the first-run setup step so both validate identically. The service catalog
 * decides whether the API key is required.
 */
export function providerSchemaFor(
  catalog: readonly ProviderServiceInfo[] | undefined,
) {
  return providerFields.superRefine((provider, context) => {
    if (
      provider.provider_type === "openai" &&
      provider.base_url !== OPENAI_BASE_URL
    ) {
      context.addIssue({
        code: "custom",
        path: ["base_url"],
        message: "OpenAI uses Asterism's fixed API URL.",
      });
    }
    if (!provider.api_key && apiKeyRequired(provider, catalog)) {
      context.addIssue({
        code: "custom",
        path: ["api_key"],
        message: "API key is required.",
      });
    }
  });
}

/** The schema before the catalog has loaded: a named service needs a key. */
export const providerSchema = providerSchemaFor(undefined);
