import type {
  ProviderService,
  ProviderServiceInfo,
  ProviderType,
} from "@/lib/client";
import { OPENAI_BASE_URL } from "./provider-schema";

/**
 * What the provider form's service dropdown can choose (ADR-0086): OpenAI, a
 * catalog service (an OpenAI-compatible provider that records it), or Custom
 * (an OpenAI-compatible provider with any URL).
 */
export type ServiceChoice = "openai" | ProviderService | "custom";

export const OPENAI_LABEL = "OpenAI";

export const SERVICE_GROUPS: {
  group: ProviderServiceInfo["group"];
  label: string;
}[] = [
  { group: "hosted", label: "Hosted APIs" },
  { group: "aggregator", label: "Aggregators" },
  { group: "local", label: "Local servers" },
];

export function choiceOf(provider: {
  provider_type: ProviderType;
  service?: ProviderService | null;
}): ServiceChoice {
  if (provider.provider_type === "openai") return "openai";
  return provider.service ?? "custom";
}

export function serviceEntry(
  choice: ServiceChoice,
  catalog: readonly ProviderServiceInfo[] | undefined,
): ProviderServiceInfo | undefined {
  return catalog?.find((entry) => entry.service === choice);
}

/** The name and base URL a choice fills in. Custom fills in nothing. */
export function choiceDefaults(
  choice: ServiceChoice,
  catalog: readonly ProviderServiceInfo[] | undefined,
): { name: string; base_url: string } {
  if (choice === "openai")
    return { name: OPENAI_LABEL, base_url: OPENAI_BASE_URL };
  const entry = serviceEntry(choice, catalog);
  return entry
    ? { name: entry.label, base_url: entry.base_url }
    : { name: "", base_url: "" };
}

/**
 * The provider fields after switching from ``previous`` to ``next``. The name
 * and base URL change only while they are empty or still ``previous``'s
 * defaults, so whatever the administrator typed is kept. OpenAI always takes
 * its fixed URL.
 */
export function applyChoice(
  current: { name: string; base_url: string },
  previous: ServiceChoice,
  next: ServiceChoice,
  catalog: readonly ProviderServiceInfo[] | undefined,
): {
  provider_type: ProviderType;
  service: ProviderService | null;
  name: string;
  base_url: string;
} {
  const before = choiceDefaults(previous, catalog);
  const after = choiceDefaults(next, catalog);
  const untouched = (value: string, initial: string) =>
    value.trim() === "" || value.trim() === initial;
  return {
    provider_type: next === "openai" ? "openai" : "generic_openai",
    service: next === "openai" || next === "custom" ? null : next,
    name: untouched(current.name, before.name) ? after.name : current.name,
    base_url:
      next === "openai"
        ? OPENAI_BASE_URL
        : previous === "openai" || untouched(current.base_url, before.base_url)
          ? after.base_url
          : current.base_url,
  };
}

/** For a local server's URL, the same URL as a container reaches the host. */
export function dockerHostUrl(baseUrl: string): string | null {
  const swapped = baseUrl.replace(
    /^(https?:\/\/)(localhost|127\.0\.0\.1)(?=[:/]|$)/i,
    "$1host.docker.internal",
  );
  return swapped === baseUrl ? null : swapped;
}
