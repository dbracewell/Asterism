import type { ProviderServiceInfo } from "@/lib/client";

/** A small slice of the backend's service catalog (ADR-0086), one per group. */
export const PROVIDER_SERVICES: ProviderServiceInfo[] = [
  {
    service: "gemini",
    label: "Google Gemini",
    group: "hosted",
    base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
    key_required: true,
    docs_url: "https://aistudio.google.com/docs/openai",
  },
  {
    service: "openrouter",
    label: "OpenRouter",
    group: "aggregator",
    base_url: "https://openrouter.ai/api/v1",
    key_required: true,
    docs_url: "https://openrouter.ai/docs/quickstart",
  },
  {
    service: "ollama",
    label: "Ollama",
    group: "local",
    base_url: "http://localhost:11434/v1",
    key_required: false,
    docs_url: "https://docs.ollama.com/api/openai-compatibility",
  },
];
