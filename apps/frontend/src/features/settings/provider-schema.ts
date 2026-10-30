import { zProviderType } from "@/lib/client/zod.gen";
import { z } from "zod";

export const OPENAI_BASE_URL = "https://api.openai.com/v1";

/**
 * One provider's connection fields, shared by Admin settings → Providers and
 * the first-run setup step so both validate identically.
 */
export const providerSchema = z
  .object({
    id: z.string(),
    name: z.string().trim().min(1, "Provider name is required."),
    base_url: z.url("Base URL must be an absolute HTTP(S) URL."),
    api_key: z.string().trim().min(1, "API key is required."),
    provider_type: zProviderType,
  })
  .superRefine((provider, context) => {
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
  });

export type ProviderFormValues = z.infer<typeof providerSchema>;
