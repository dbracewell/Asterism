import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { ProviderSettings } from "@/lib/client";
import { OPENAI_BASE_URL, providerSchema, ProvidersTab } from "./providers-tab";

const settings: ProviderSettings = {
  draft_model_id: null,
  llm_providers: [
    {
      id: "20000000-0000-4000-8000-000000000001",
      name: "Large catalog",
      provider_type: "generic_openai",
      base_url: "http://localhost:8080/v1",
      api_key: "secret",
      model_count: 1000,
      active_model_count: 4,
    },
  ],
};

vi.mock("@/lib/client/@tanstack/react-query.gen", () => ({
  appProviderModelsDiscoverAndSyncMutation: () => ({ mutationFn: vi.fn() }),
  appProviderModelsListOptions: () => ({
    queryKey: ["appProviderModelsList"],
    queryFn: () => Promise.resolve({ models: [], total: 0 }),
  }),
  appProviderModelUpdateMutation: () => ({ mutationFn: vi.fn() }),
  appProviderSettingsGetOptions: () => ({
    queryKey: ["appProviderSettingsGet"],
    queryFn: () => Promise.resolve(settings),
  }),
  appProviderSettingsGetQueryKey: () => ["appProviderSettingsGet"],
  appProviderSettingsUpdateMutation: () => ({ mutationFn: vi.fn() }),
}));

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      {children}
    </QueryClientProvider>
  );
}

describe("provider model browser", () => {
  it("validates OpenAI's canonical URL", () => {
    expect(
      providerSchema.safeParse({
        id: crypto.randomUUID(),
        name: "OpenAI",
        api_key: "secret",
        provider_type: "openai",
        base_url: OPENAI_BASE_URL,
      }).success,
    ).toBe(true);
    expect(
      providerSchema.safeParse({
        id: crypto.randomUUID(),
        name: "OpenAI",
        api_key: "secret",
        provider_type: "openai",
        base_url: "https://example.test/v1",
      }).success,
    ).toBe(false);
  });

  it("defers a large catalog until the administrator opens it", () => {
    render(<ProvidersTab appSettings={settings} />, { wrapper: Wrapper });
    expect(
      screen.getByRole("button", { name: "Browse 1,000 models" }),
    ).toBeVisible();
    expect(
      screen.queryByLabelText("Search Large catalog models"),
    ).not.toBeInTheDocument();
  });
});
